'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode  = require('qrcode-terminal');
const http    = require('http');
const path    = require('path');

// ═══════════════════════════════════════════════════════════════
//  CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════════
const NUMERO_SECRETARIA  = process.env.NUMERO_SECRETARIA || '';
const PORT               = parseInt(process.env.PORT, 10) || 3000;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;   // 30 min sem resposta → encerra sessão
const SEND_TIMEOUT_MS    = 15_000;            // 15s máx para enviar 1 mensagem
const MAX_RETRIES        = 3;                 // tentativas antes de desistir
const RETRY_DELAY_MS     = 2_000;            // espera entre tentativas

// ═══════════════════════════════════════════════════════════════
//  LOGS COM TIMESTAMP
// ═══════════════════════════════════════════════════════════════
const log = {
    info : (...a) => console.log (`[${ts()}] ℹ️ `, ...a),
    ok   : (...a) => console.log (`[${ts()}] ✅`, ...a),
    warn : (...a) => console.warn(`[${ts()}] ⚠️ `, ...a),
    error: (...a) => console.error(`[${ts()}] ❌`, ...a),
    msg  : (...a) => console.log (`[${ts()}] 📩`, ...a),
};
const ts = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

// ═══════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════
let clientReady      = false;
let reconnectAttempt = 0;
const stats = { totalAtendimentos: 0, erros: 0, iniciadoEm: new Date() };

// sessões: { [from]: { etapa, dados, lastActivity, timeoutId } }
const sessions = {};

// filas por usuário: { [from]: Promise }  — garante processamento sequencial
const filas = {};

// ═══════════════════════════════════════════════════════════════
//  HEALTH CHECK — servidor HTTP
// ═══════════════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
    const uptime   = Math.floor((Date.now() - stats.iniciadoEm) / 1000);
    const hh       = String(Math.floor(uptime / 3600)).padStart(2, '0');
    const mm       = String(Math.floor((uptime % 3600) / 60)).padStart(2, '0');
    const ss       = String(uptime % 60).padStart(2, '0');
    const body     = JSON.stringify({
        status           : clientReady ? 'online' : 'aguardando_qr',
        uptime           : `${hh}:${mm}:${ss}`,
        sessoes_ativas   : Object.keys(sessions).length,
        total_atendimentos: stats.totalAtendimentos,
        erros_registrados: stats.erros,
        secretaria       : NUMERO_SECRETARIA ? 'configurado' : 'NAO_CONFIGURADO',
    }, null, 2);

    res.writeHead(clientReady ? 200 : 503, {
        'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(body);
});

server.listen(PORT, () => log.info(`Servidor HTTP na porta ${PORT}`));

// ═══════════════════════════════════════════════════════════════
//  CLIENTE WHATSAPP
// ═══════════════════════════════════════════════════════════════
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(process.cwd(), '.wwebjs_auth'),
    }),
    webVersionCache: {
        type      : 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1018873837-alpha.html',
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process',
        ],
    },
});

// ═══════════════════════════════════════════════════════════════
//  ENVIO COM TIMEOUT + RETRY AUTOMÁTICO
// ═══════════════════════════════════════════════════════════════
async function sendWithRetry(to, text, tentativa = 1) {
    try {
        await Promise.race([
            client.sendMessage(to, text),
            new Promise((_, rej) =>
                setTimeout(() => rej(new Error('timeout_send')), SEND_TIMEOUT_MS)
            ),
        ]);
        return true;
    } catch (err) {
        log.warn(`Falha ao enviar para ${to} (tentativa ${tentativa}/${MAX_RETRIES}): ${err.message}`);
        if (tentativa < MAX_RETRIES) {
            await delay(RETRY_DELAY_MS * tentativa); // backoff exponencial
            return sendWithRetry(to, text, tentativa + 1);
        }
        stats.erros++;
        log.error(`Desistindo após ${MAX_RETRIES} tentativas para ${to}`);
        return false;
    }
}

async function send(to, text) {
    await delay(900);
    return sendWithRetry(to, text);
}

// ═══════════════════════════════════════════════════════════════
//  FILA DE MENSAGENS — processa 1 por vez por usuário
// ═══════════════════════════════════════════════════════════════
function enfileirar(from, fn) {
    const anterior = filas[from] || Promise.resolve();
    filas[from] = anterior.then(fn).catch(err => {
        stats.erros++;
        log.error(`Erro na fila de ${from}:`, err.message);
    });
}

// ═══════════════════════════════════════════════════════════════
//  TIMEOUT DE SESSÃO — encerra sessões abandonadas
// ═══════════════════════════════════════════════════════════════
function renovarTimeout(from) {
    const session = sessions[from];
    if (!session) return;
    if (session.timeoutId) clearTimeout(session.timeoutId);
    session.lastActivity = Date.now();
    session.timeoutId = setTimeout(async () => {
        log.warn(`Sessão expirada por inatividade: ${from}`);
        delete sessions[from];
        delete filas[from];
        await send(from,
            'Sua sessão expirou por inatividade. 😊\n\n' +
            'Quando quiser agendar é só mandar uma mensagem!'
        );
    }, SESSION_TIMEOUT_MS);
}

function encerrarSessao(from) {
    const session = sessions[from];
    if (session?.timeoutId) clearTimeout(session.timeoutId);
    delete sessions[from];
    delete filas[from];
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
const delay         = ms => new Promise(r => setTimeout(r, ms));
const fone          = from => from.split('@')[0];
const primeiroNome  = nome => (nome || '').trim().split(' ')[0];
const prioridade    = dor => {
    const n = parseInt(dor, 10);
    if (n >= 8) return '🔴 URGENTE';
    if (n >= 5) return '🟡 MODERADO';
    return '🟢 ELETIVO';
};

// ═══════════════════════════════════════════════════════════════
//  ETAPAS
// ═══════════════════════════════════════════════════════════════
const E = {
    NOME:'nome', IDADE:'idade', ESPECIALIDADE:'especialidade',
    QUEIXA:'queixa', CONVENIO:'convenio', CONVENIO_QUAL:'convenio_qual',
    DOR:'dor', EXTRAS:'extras', CONFIRMACAO:'confirmacao',
};

// ═══════════════════════════════════════════════════════════════
//  FLUXO DE ATENDIMENTO
// ═══════════════════════════════════════════════════════════════
async function iniciarConversa(from) {
    sessions[from] = { etapa: E.NOME, dados: {} };
    renovarTimeout(from);
    log.info(`Nova sessão: ${from}`);
    await send(from,
        'Olá! 👋 Bem-vindo(a) à nossa clínica!\n\n' +
        'Sou o assistente virtual e vou te ajudar com o pré-atendimento. ' +
        'Ao final, nossa equipe entrará em contato para confirmar o agendamento. 😊\n\n' +
        'Para começar: qual é o seu *nome completo*?'
    );
}

async function finalizarAtendimento(from, dados) {
    const prio = prioridade(dados.dor);
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const relatorio =
        '━━━━━━━━━━━━━━━━━━━━━━━\n' +
        '🏥 *NOVO PRÉ-ATENDIMENTO*\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━\n' +
        `🕐 *Data/Hora:* ${agora}\n` +
        `⚡ *Prioridade:* ${prio}\n\n` +
        '👤 *DADOS DO PACIENTE*\n' +
        `• *Nome:* ${dados.nome}\n` +
        `• *Idade:* ${dados.idade} anos\n` +
        `• *WhatsApp:* +${fone(from)}\n` +
        `• *Convênio:* ${dados.convenio}\n\n` +
        '🩺 *TRIAGEM*\n' +
        `• *Especialidade:* ${dados.especialidade}\n` +
        `• *Queixa:* ${dados.queixa}\n` +
        `• *Nível de dor:* ${dados.dor}/10 — ${prio}\n` +
        `• *Obs.:* ${dados.extras || 'Nenhuma'}\n` +
        '━━━━━━━━━━━━━━━━━━━━━━━\n' +
        '_Powered by Nexora AI_';

    if (NUMERO_SECRETARIA) {
        const ok = await sendWithRetry(`${NUMERO_SECRETARIA}@c.us`, relatorio);
        if (ok) log.ok(`Relatório enviado à secretária (${NUMERO_SECRETARIA})`);
    } else {
        log.warn('NUMERO_SECRETARIA não configurado. Relatório:\n' + relatorio);
    }

    await send(from,
        `✅ *Pronto, ${primeiroNome(dados.nome)}!*\n\n` +
        'Recebi todas as suas informações e já encaminhei para nossa equipe. 🎉\n\n' +
        'Em breve um de nossos atendentes entrará em contato para *confirmar o agendamento*.\n\n' +
        '_Horário de atendimento: segunda a sexta, das 8h às 18h._'
    );
    await delay(1000);
    await send(from, 'Muito obrigado pela confiança! Até logo! 🙏😊');

    stats.totalAtendimentos++;
    log.ok(`Atendimento finalizado: ${from} | Total: ${stats.totalAtendimentos}`);
    encerrarSessao(from);
}

async function processarMensagem(from, body) {
    const session = sessions[from];
    if (!session) return;
    renovarTimeout(from);

    const { etapa, dados } = session;
    const fn = primeiroNome(dados.nome);
    log.msg(`[${from}] etapa=${etapa} | "${body}"`);

    switch (etapa) {

        case E.NOME: {
            if (body.trim().split(' ').length < 2) {
                return send(from, 'Por favor, informe seu *nome completo* (nome e sobrenome). 😊');
            }
            dados.nome = body.trim();
            session.etapa = E.IDADE;
            return send(from, `Prazer, *${primeiroNome(dados.nome)}*! 😄\n\nQual a sua *idade*?`);
        }

        case E.IDADE: {
            const idade = parseInt(body, 10);
            if (isNaN(idade) || idade <= 0 || idade > 120) {
                return send(from, 'Por favor, informe sua *idade* em números. Ex: *34*');
            }
            dados.idade = idade;
            session.etapa = E.ESPECIALIDADE;
            return send(from,
                'Anotado! 📝\n\n' +
                'Qual *especialidade* você está buscando?\n\n' +
                '_Exemplos: Clínico Geral, Ortopedia, Cardiologia, Pediatria, Ginecologia..._'
            );
        }

        case E.ESPECIALIDADE: {
            dados.especialidade = body.trim();
            session.etapa = E.QUEIXA;
            return send(from,
                'Certo! 🩺\n\n' +
                'Me conta *o que está acontecendo*. Como você está se sentindo? Desde quando?\n\n' +
                '_Pode descrever com suas palavras mesmo. 😊_'
            );
        }

        case E.QUEIXA: {
            if (body.trim().length < 5) {
                return send(from, 'Pode dar um pouco mais de detalhes? Isso ajuda muito o médico! 😊');
            }
            dados.queixa = body.trim();
            session.etapa = E.CONVENIO;
            return send(from,
                `Entendido, *${fn}*. Tudo anotado. 📋\n\n` +
                'Você possui *plano de saúde ou convênio*?\n\n' +
                '*1 —* Sim, tenho convênio\n' +
                '*2 —* Não, serei particular'
            );
        }

        case E.CONVENIO: {
            const r = body.trim().toLowerCase();
            const temConvenio = r === '1' || /sim|tenho|possuo|plano|conv/.test(r);
            const particular  = r === '2' || /n[aã]o|particular|sem/.test(r);
            if (temConvenio) {
                session.etapa = E.CONVENIO_QUAL;
                return send(from, 'Qual o nome do seu *plano de saúde ou convênio*?');
            } else if (particular) {
                dados.convenio = 'Particular';
                session.etapa = E.DOR;
                return send(from,
                    'Atendimento *particular*, anotado! 👍\n\n' +
                    'De *0 a 10*, qual o seu nível de *dor ou desconforto* agora?\n\n' +
                    '_0 = Sem dor  |  10 = Dor insuportável_'
                );
            } else {
                return send(from, 'Responda *1* (tenho convênio) ou *2* (particular). 😊');
            }
        }

        case E.CONVENIO_QUAL: {
            dados.convenio = body.trim();
            session.etapa = E.DOR;
            return send(from,
                `*${dados.convenio}* — anotado! ✅\n\n` +
                'De *0 a 10*, qual o seu nível de *dor ou desconforto* agora?\n\n' +
                '_0 = Sem dor  |  10 = Dor insuportável_'
            );
        }

        case E.DOR: {
            const dor = parseInt(body, 10);
            if (isNaN(dor) || dor < 0 || dor > 10) {
                return send(from, 'Por favor, informe um número de *0 a 10*. 😊');
            }
            dados.dor = dor;
            session.etapa = E.EXTRAS;
            const fb = dor >= 8
                ? `*${dor}/10* 😟 — Muita dor! Vou marcar como *urgente* para nossa equipe.\n\n`
                : dor === 0 ? '*Sem dor* — Ótimo! Anotado. 📋\n\n'
                : `*${dor}/10* — Anotado! 📋\n\n`;
            return send(from,
                fb +
                'Tem alguma informação importante a acrescentar?\n' +
                '_Ex: alergias, remédios que usa..._\n\n' +
                '_Se não tiver, responda "não". 😊_'
            );
        }

        case E.EXTRAS: {
            const r = body.trim().toLowerCase();
            dados.extras = /^(n[aã]o|nada|nenhum[a]?|sem|-)$/.test(r) ? 'Nenhuma' : body.trim();
            session.etapa = E.CONFIRMACAO;
            return send(from,
                'Quase pronto! 🎯 Confirme seus dados:\n\n' +
                `👤 *Nome:* ${dados.nome}\n` +
                `🎂 *Idade:* ${dados.idade} anos\n` +
                `📱 *WhatsApp:* +${fone(from)}\n` +
                `🏥 *Especialidade:* ${dados.especialidade}\n` +
                `💬 *Queixa:* ${dados.queixa}\n` +
                `🩺 *Convênio:* ${dados.convenio}\n` +
                `😣 *Dor:* ${dados.dor}/10\n` +
                `📝 *Obs.:* ${dados.extras}\n\n` +
                'Está tudo *certo*?\n\n' +
                '*1 —* Sim, confirmar!\n' +
                '*2 —* Preciso corrigir algo'
            );
        }

        case E.CONFIRMACAO: {
            const r = body.trim().toLowerCase();
            const confirmou = r === '1' || /sim|correto|certo|ok|isso|confirm/.test(r);
            const corrigir  = r === '2' || /n[aã]o|corrig|errad|volta/.test(r);
            if (confirmou) {
                return finalizarAtendimento(from, dados);
            } else if (corrigir) {
                encerrarSessao(from);
                await send(from, 'Tudo bem! Vamos recomeçar para corrigir. 😊');
                await delay(500);
                return iniciarConversa(from);
            } else {
                return send(from, 'Responda *1* para confirmar ou *2* para corrigir. 😊');
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  EVENTOS DO WHATSAPP
// ═══════════════════════════════════════════════════════════════
client.on('qr', qr => {
    console.log('\n════════════════════════════════════════');
    console.log('📱 ESCANEIE O QR CODE COM O WHATSAPP');
    console.log('════════════════════════════════════════\n');
    qrcode.generate(qr, { small: true });
    console.log('\n════════════════════════════════════════\n');
});

client.on('authenticated', () => log.ok('WhatsApp autenticado!'));
client.on('auth_failure',  msg => log.error('Falha de autenticação:', msg));

client.on('ready', () => {
    clientReady      = true;
    reconnectAttempt = 0;
    log.ok('Bot ONLINE! Pronto para atender.');
    log.info(`Secretária: ${NUMERO_SECRETARIA || 'NÃO CONFIGURADO ⚠️'}`);
});

client.on('disconnected', reason => {
    clientReady = false;
    log.warn('Bot desconectado:', reason);
    reconnectAttempt++;
    const espera = Math.min(5000 * reconnectAttempt, 60_000); // até 60s
    log.info(`Reconectando em ${espera / 1000}s (tentativa ${reconnectAttempt})...`);
    setTimeout(() => {
        client.initialize().catch(err => log.error('Erro ao reconectar:', err.message));
    }, espera);
});

// ── Recebe mensagens com fila por usuário ───────────────────
client.on('message', msg => {
    if (msg.from.includes('@g.us'))      return;  // ignora grupos
    if (msg.from === 'status@broadcast') return;  // ignora status
    if (msg.fromMe)                      return;  // ignora próprio bot

    const from = msg.from;
    const body = (msg.body || '').trim();
    if (!body) return;

    log.msg(`De ${from}: "${body}"`);

    // Enfileira por usuário — sem processamento paralelo por pessoa
    enfileirar(from, async () => {
        if (!sessions[from]) {
            await iniciarConversa(from);
        } else {
            await processarMensagem(from, body);
        }
    });
});

// ═══════════════════════════════════════════════════════════════
//  INICIALIZAR
// ═══════════════════════════════════════════════════════════════
log.info('Inicializando cliente WhatsApp...');
client.initialize().catch(err => {
    log.error('Erro fatal na inicialização:', err.message);
    process.exit(1);
});

// Captura erros não tratados para não derrubar o processo
process.on('unhandledRejection', (reason) => {
    stats.erros++;
    log.error('Promise não tratada:', reason);
});
process.on('uncaughtException', (err) => {
    stats.erros++;
    log.error('Exceção não capturada:', err.message);
});
