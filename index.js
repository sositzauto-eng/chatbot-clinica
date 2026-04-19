const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const http = require('http');
const path = require('path');

console.log("🚀 Iniciando chatbot da clínica...");

// ─────────────────────────────────────────────────────────────
//  CONFIGURAÇÃO — variáveis de ambiente no Railway:
//  NUMERO_SECRETARIA=5511999999999   (somente números, sem +)
// ─────────────────────────────────────────────────────────────
const NUMERO_SECRETARIA = process.env.NUMERO_SECRETARIA || '';
const PORT = process.env.PORT || 3000;

// ─── Servidor HTTP (obrigatório no Railway) ───────────────────
let clientReady = false;
const server = http.createServer((req, res) => {
    const status = clientReady ? '🟢 Bot online' : '🟡 Aguardando QR Code';
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Chatbot Clinica — ${status}\n`);
});
server.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
});

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(process.cwd(), '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process'
        ]
    }
});

// ─── Helpers ──────────────────────────────────────────────────

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function send(to, text) {
    await delay(800);
    try {
        await client.sendMessage(to, text);
    } catch (err) {
        console.error(`Erro ao enviar mensagem para ${to}:`, err.message);
    }
}

function formatarTelefone(from) {
    return from.replace('@c.us', '').replace('@s.whatsapp.net', '');
}

function primeiroNome(nomeCompleto) {
    return (nomeCompleto || '').split(' ')[0];
}

function avaliarPrioridade(dor) {
    const n = parseInt(dor, 10);
    if (n >= 8) return '🔴 URGENTE';
    if (n >= 5) return '🟡 MODERADO';
    return '🟢 ELETIVO';
}

// ─── Etapas ───────────────────────────────────────────────────

const ETAPA = {
    NOME: 'nome', IDADE: 'idade', ESPECIALIDADE: 'especialidade',
    QUEIXA: 'queixa', CONVENIO: 'convenio', CONVENIO_QUAL: 'convenio_qual',
    DOR: 'dor', EXTRAS: 'extras', CONFIRMACAO: 'confirmacao'
};

const sessions = {};

// ─── Início ───────────────────────────────────────────────────

async function iniciarConversa(from) {
    sessions[from] = { etapa: ETAPA.NOME, dados: {} };
    console.log(`Nova conversa: ${from}`);
    await send(from,
        `Olá! 👋 Bem-vindo(a) à nossa clínica!\n\n` +
        `Sou o assistente virtual e vou te ajudar com o pré-atendimento de forma rápida e simples. ` +
        `Ao final, nossa equipe entrará em contato para confirmar o agendamento. 😊\n\n` +
        `Para começar: qual é o seu *nome completo*?`
    );
}

// ─── Relatório ────────────────────────────────────────────────

async function finalizarAtendimento(from, dados) {
    const telefone = formatarTelefone(from);
    const prioridade = avaliarPrioridade(dados.dor);
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const relatorio =
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *NOVO PRÉ-ATENDIMENTO*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕐 *Data/Hora:* ${agora}\n` +
        `⚡ *Prioridade:* ${prioridade}\n\n` +
        `👤 *DADOS DO PACIENTE*\n` +
        `• *Nome:* ${dados.nome}\n` +
        `• *Idade:* ${dados.idade} anos\n` +
        `• *Telefone:* +${telefone}\n` +
        `• *Convenio:* ${dados.convenio}\n\n` +
        `🩺 *TRIAGEM*\n` +
        `• *Especialidade:* ${dados.especialidade}\n` +
        `• *Queixa principal:* ${dados.queixa}\n` +
        `• *Nivel de dor:* ${dados.dor}/10 — ${prioridade}\n` +
        `• *Informacoes adicionais:* ${dados.extras || 'Nenhuma'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Paciente aguarda contato para agendamento._`;

    if (NUMERO_SECRETARIA) {
        try {
            await client.sendMessage(`${NUMERO_SECRETARIA}@c.us`, relatorio);
            console.log(`Relatorio enviado para secretaria (${NUMERO_SECRETARIA})`);
        } catch (err) {
            console.error('Erro ao enviar relatorio para secretaria:', err.message);
            console.log('\nRELATORIO (fallback):\n', relatorio);
        }
    } else {
        console.log('\nRELATORIO GERADO:\n', relatorio);
    }

    await send(from,
        `✅ *Pronto, ${primeiroNome(dados.nome)}!*\n\n` +
        `Recebi todas as suas informações e já encaminhei para nossa equipe. 🎉\n\n` +
        `Em breve um de nossos atendentes entrará em contato pelo WhatsApp para *confirmar o seu agendamento*.\n\n` +
        `_Nosso horário de atendimento é de segunda a sexta, das 8h às 18h._`
    );
    await delay(1000);
    await send(from, `Muito obrigado pela confiança! Qualquer dúvida, é só chamar. Até logo! 🙏😊`);
    delete sessions[from];
    console.log(`Atendimento finalizado: ${from}`);
}

// ─── Processamento ────────────────────────────────────────────

async function processarMensagem(from, body) {
    const session = sessions[from];
    if (!session) return;
    const { etapa, dados } = session;
    const fn = primeiroNome(dados.nome);
    console.log(`[${from}] etapa=${etapa} msg="${body}"`);

    switch (etapa) {

        case ETAPA.NOME: {
            if (body.trim().split(' ').length < 2) {
                await send(from, 'Por favor, me informe seu *nome completo* (nome e sobrenome). 😊');
                return;
            }
            dados.nome = body.trim();
            session.etapa = ETAPA.IDADE;
            await send(from, `Prazer, *${primeiroNome(dados.nome)}*! 😄\n\nQual a sua *idade*?`);
            break;
        }

        case ETAPA.IDADE: {
            const idade = parseInt(body, 10);
            if (isNaN(idade) || idade < 0 || idade > 120) {
                await send(from, 'Hmm, não entendi. Pode me informar sua *idade* em números? Ex: *34*');
                return;
            }
            dados.idade = idade;
            session.etapa = ETAPA.ESPECIALIDADE;
            await send(from,
                `Anotado! 📝\n\nQual *especialidade* você está buscando?\n\n` +
                `_Exemplos: Clínico Geral, Ortopedia, Cardiologia, Pediatria, Ginecologia, Dermatologia... ` +
                `ou me descreva o que está sentindo que te oriento!_ 😊`
            );
            break;
        }

        case ETAPA.ESPECIALIDADE: {
            dados.especialidade = body.trim();
            session.etapa = ETAPA.QUEIXA;
            await send(from,
                `Certo! 🩺\n\nAgora me conta *o que está acontecendo*. ` +
                `Como você está se sentindo? Desde quando? ` +
                `Pode me contar com suas palavras mesmo, sem pressa. 😊`
            );
            break;
        }

        case ETAPA.QUEIXA: {
            if (body.trim().length < 5) {
                await send(from, 'Pode me dar um pouco mais de detalhes sobre o que está sentindo? Isso ajuda muito o médico! 😊');
                return;
            }
            dados.queixa = body.trim();
            session.etapa = ETAPA.CONVENIO;
            await send(from,
                `Entendido, *${fn}*. Vou deixar tudo registrado para o médico. 📋\n\n` +
                `Você possui *plano de saúde ou convênio*?\n\n` +
                `*1 —* Sim, tenho convênio\n` +
                `*2 —* Não, serei particular`
            );
            break;
        }

        case ETAPA.CONVENIO: {
            const r = body.trim().toLowerCase();
            const temConvenio = r === '1' || /sim|tenho|possuo/.test(r);
            const particular  = r === '2' || /n[aã]o|particular|sem/.test(r);
            if (temConvenio) {
                session.etapa = ETAPA.CONVENIO_QUAL;
                await send(from, 'Ótimo! Qual é o nome do seu *plano de saúde ou convênio*?');
            } else if (particular) {
                dados.convenio = 'Particular';
                session.etapa = ETAPA.DOR;
                await send(from,
                    `Atendimento *particular*, anotado! 👍\n\n` +
                    `Agora, numa escala de *0 a 10*, qual o seu nível de *dor ou desconforto* neste momento?\n\n` +
                    `_0 = Sem dor  |  10 = Dor insuportável_`
                );
            } else {
                await send(from, 'Pode responder *1* (tenho convênio) ou *2* (serei particular). 😊');
            }
            break;
        }

        case ETAPA.CONVENIO_QUAL: {
            dados.convenio = body.trim();
            session.etapa = ETAPA.DOR;
            await send(from,
                `*${dados.convenio}* — anotado! ✅\n\n` +
                `Numa escala de *0 a 10*, qual o seu nível de *dor ou desconforto* agora?\n\n` +
                `_0 = Sem dor  |  10 = Dor insuportável_`
            );
            break;
        }

        case ETAPA.DOR: {
            const dor = parseInt(body, 10);
            if (isNaN(dor) || dor < 0 || dor > 10) {
                await send(from, 'Por favor, informe um número de *0 a 10* para o nível de dor. 😊');
                return;
            }
            dados.dor = dor;
            session.etapa = ETAPA.EXTRAS;
            let feedbackDor = dor >= 8
                ? `*${dor}/10* 😟 — Entendo que você está com muita dor. Vou marcar como *urgente*!\n\n`
                : dor === 0 ? `*Sem dor* — Ótimo! Anotado. 📋\n\n`
                : `*${dor}/10* — Anotado! 📋\n\n`;
            await send(from,
                `${feedbackDor}` +
                `Para finalizar: tem alguma informação importante que queira acrescentar?\n` +
                `Por exemplo: *alergias a medicamentos*, remédios que usa atualmente, ou qualquer detalhe relevante.\n\n` +
                `_Se não houver nada, é só responder "não". 😊_`
            );
            break;
        }

        case ETAPA.EXTRAS: {
            const r = body.trim().toLowerCase();
            dados.extras = /^(n[aã]o|nada|nenhum[a]?|sem|-)$/.test(r) ? 'Nenhuma' : body.trim();
            session.etapa = ETAPA.CONFIRMACAO;
            const d = dados;
            await send(from,
                `Quase pronto! 🎯 Deixa eu confirmar seus dados:\n\n` +
                `👤 *Nome:* ${d.nome}\n` +
                `🎂 *Idade:* ${d.idade} anos\n` +
                `📱 *Telefone:* +${formatarTelefone(from)}\n` +
                `🏥 *Especialidade:* ${d.especialidade}\n` +
                `💬 *Queixa:* ${d.queixa}\n` +
                `🩺 *Convênio:* ${d.convenio}\n` +
                `😣 *Nível de dor:* ${d.dor}/10\n` +
                `📝 *Obs.:* ${d.extras}\n\n` +
                `Está tudo *certo*?\n\n` +
                `*1 —* Sim, está correto!\n` +
                `*2 —* Preciso corrigir algo`
            );
            break;
        }

        case ETAPA.CONFIRMACAO: {
            const r = body.trim().toLowerCase();
            const confirmou = r === '1' || /sim|correto|certo|ok|isso/.test(r);
            const corrigir  = r === '2' || /n[aã]o|corrig|errad|volta/.test(r);
            if (confirmou) {
                await finalizarAtendimento(from, dados);
            } else if (corrigir) {
                delete sessions[from];
                await send(from, 'Tudo bem! Vamos recomeçar para corrigir as informações. 😊');
                await delay(600);
                await iniciarConversa(from);
            } else {
                await send(from, 'Responda *1* para confirmar ou *2* para corrigir. 😊');
            }
            break;
        }
    }
}

// ─── Eventos ──────────────────────────────────────────────────

client.on('qr', (qr) => {
    console.log('\n============================================');
    console.log('📱 ESCANEIE O QR CODE ABAIXO COM O WHATSAPP');
    console.log('============================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\n============================================\n');
});

client.on('authenticated', () => console.log('🔐 WhatsApp autenticado!'));
client.on('auth_failure', (msg) => console.error('❌ Falha na autenticação:', msg));

client.on('ready', () => {
    clientReady = true;
    console.log('🤖 Bot ONLINE! Pronto para atender.');
    console.log(`📨 Secretária: ${NUMERO_SECRETARIA || 'NÃO CONFIGURADO'}`);
});

client.on('disconnected', (reason) => {
    clientReady = false;
    console.warn('⚠️ Bot desconectado:', reason);
    setTimeout(() => client.initialize().catch(console.error), 10000);
});

client.on('message', async (msg) => {
    if (msg.from.includes('@g.us')) return;
    if (msg.from === 'status@broadcast') return;
    if (msg.fromMe) return;

    const from = msg.from;
    const body = (msg.body || '').trim();
    if (!body) return;

    console.log(`📩 De ${from}: "${body}"`);

    try {
        if (!sessions[from]) {
            await iniciarConversa(from);
        } else {
            await processarMensagem(from, body);
        }
    } catch (err) {
        console.error(`❌ Erro [${from}]:`, err.message, err.stack);
    }
});

client.initialize().catch(err => {
    console.error('❌ Erro fatal:', err);
    process.exit(1);
});
