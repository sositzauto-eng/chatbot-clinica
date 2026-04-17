const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log("🚀 Iniciando chatbot da clínica...");

// ─────────────────────────────────────────────────────────────
//  CONFIGURAÇÃO — defina a variável de ambiente no seu servidor
//  NUMERO_SECRETARIA=5511999999999   (somente números, sem +)
// ─────────────────────────────────────────────────────────────
const NUMERO_SECRETARIA = process.env.NUMERO_SECRETARIA || '';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote'
        ]
    }
});

// ─── Helpers ──────────────────────────────────────────────────

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function send(to, text) {
    await delay(700);
    await client.sendMessage(to, text);
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

// ─── Etapas da conversa ───────────────────────────────────────

const ETAPA = {
    NOME:          'nome',
    IDADE:         'idade',
    ESPECIALIDADE: 'especialidade',
    QUEIXA:        'queixa',
    CONVENIO:      'convenio',
    CONVENIO_QUAL: 'convenio_qual',
    DOR:           'dor',
    EXTRAS:        'extras',
    CONFIRMACAO:   'confirmacao'
};

const sessions = {};

// ─── Início da conversa ───────────────────────────────────────

async function iniciarConversa(from) {
    sessions[from] = { etapa: ETAPA.NOME, dados: {} };
    await send(from,
        `Olá! 👋 Bem-vindo(a) à nossa clínica!\n\n` +
        `Sou o assistente virtual e vou te ajudar com o pré-atendimento de forma rápida e simples. ` +
        `Ao final, nossa equipe entrará em contato para confirmar o agendamento. 😊\n\n` +
        `Para começar: qual é o seu *nome completo*?`
    );
}

// ─── Relatório para a secretária ──────────────────────────────

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
        `• *Convênio:* ${dados.convenio}\n\n` +
        `🩺 *TRIAGEM*\n` +
        `• *Especialidade desejada:* ${dados.especialidade}\n` +
        `• *Queixa principal:* ${dados.queixa}\n` +
        `• *Nível de dor:* ${dados.dor}/10 — ${prioridade}\n` +
        `• *Informações adicionais:* ${dados.extras || 'Nenhuma'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Paciente aguarda contato para agendamento._`;

    // Envia o relatório para a secretária
    if (NUMERO_SECRETARIA) {
        try {
            await client.sendMessage(`${NUMERO_SECRETARIA}@c.us`, relatorio);
            console.log(`📨 Relatório enviado para a secretária (${NUMERO_SECRETARIA})`);
        } catch (err) {
            console.error('❌ Erro ao enviar relatório para secretária:', err.message);
            console.log('\n📊 RELATÓRIO (fallback console):\n', relatorio);
        }
    } else {
        console.log('\n📊 RELATÓRIO GERADO (NUMERO_SECRETARIA não configurado):\n', relatorio);
    }

    // Mensagem de encerramento ao paciente
    await send(from,
        `✅ *Pronto, ${primeiroNome(dados.nome)}!*\n\n` +
        `Recebi todas as suas informações e já encaminhei para nossa equipe. 🎉\n\n` +
        `Em breve um de nossos atendentes entrará em contato pelo WhatsApp para *confirmar o seu agendamento*.\n\n` +
        `_Nosso horário de atendimento é de segunda a sexta, das 8h às 18h._`
    );
    await delay(1000);
    await send(from, `Muito obrigado pela confiança! Qualquer dúvida, é só chamar. Até logo! 🙏😊`);

    delete sessions[from];
}

// ─── Processamento das respostas ──────────────────────────────

async function processarMensagem(from, body) {
    const session = sessions[from];
    if (!session) return;

    const { etapa, dados } = session;
    const fn = primeiroNome(dados.nome);

    switch (etapa) {

        // ── Nome ────────────────────────────────────────────────
        case ETAPA.NOME: {
            if (body.trim().split(' ').length < 2) {
                await send(from, 'Por favor, me informe seu *nome completo* (nome e sobrenome). 😊');
                return;
            }
            dados.nome = body.trim();
            session.etapa = ETAPA.IDADE;
            await send(from,
                `Prazer, *${primeiroNome(dados.nome)}*! 😄\n\n` +
                `Qual a sua *idade*?`
            );
            break;
        }

        // ── Idade ───────────────────────────────────────────────
        case ETAPA.IDADE: {
            const idade = parseInt(body, 10);
            if (isNaN(idade) || idade < 0 || idade > 120) {
                await send(from, 'Hmm, não entendi. Pode me informar sua *idade* em números? Ex: *34*');
                return;
            }
            dados.idade = idade;
            session.etapa = ETAPA.ESPECIALIDADE;
            await send(from,
                `Anotado! 📝\n\n` +
                `Qual *especialidade* você está buscando?\n\n` +
                `_Exemplos: Clínico Geral, Ortopedia, Cardiologia, Pediatria, Ginecologia, Dermatologia... ` +
                `ou me descreva o que está sentindo que te oriento!_ 😊`
            );
            break;
        }

        // ── Especialidade ────────────────────────────────────────
        case ETAPA.ESPECIALIDADE: {
            dados.especialidade = body.trim();
            session.etapa = ETAPA.QUEIXA;
            await send(from,
                `Certo! 🩺\n\n` +
                `Agora me conta *o que está acontecendo*. ` +
                `Como você está se sentindo? Desde quando? ` +
                `Pode me contar com suas palavras mesmo, sem pressa. 😊`
            );
            break;
        }

        // ── Queixa principal ─────────────────────────────────────
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

        // ── Convênio (sim/não) ────────────────────────────────────
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
                    `_0 = Sem dor &nbsp;|&nbsp; 10 = Dor insuportável_`
                );
            } else {
                await send(from, 'Pode responder *1* (tenho convênio) ou *2* (serei particular). 😊');
            }
            break;
        }

        // ── Nome do convênio ──────────────────────────────────────
        case ETAPA.CONVENIO_QUAL: {
            dados.convenio = body.trim();
            session.etapa = ETAPA.DOR;
            await send(from,
                `*${dados.convenio}* — anotado! ✅\n\n` +
                `Numa escala de *0 a 10*, qual o seu nível de *dor ou desconforto* agora?\n\n` +
                `_0 = Sem dor &nbsp;|&nbsp; 10 = Dor insuportável_`
            );
            break;
        }

        // ── Dor 0–10 ──────────────────────────────────────────────
        case ETAPA.DOR: {
            const dor = parseInt(body, 10);
            if (isNaN(dor) || dor < 0 || dor > 10) {
                await send(from, 'Por favor, informe um número de *0 a 10* para o nível de dor. 😊');
                return;
            }
            dados.dor = dor;
            session.etapa = ETAPA.EXTRAS;

            let feedbackDor = '';
            if (dor >= 8) {
                feedbackDor =
                    `*${dor}/10* 😟 — Entendo que você está com muita dor. ` +
                    `Vou marcar como *urgente* para nossa equipe priorizar o seu atendimento!\n\n`;
            } else if (dor >= 5) {
                feedbackDor = `*${dor}/10* — Anotado, vou deixar registrado para o médico. 📋\n\n`;
            } else if (dor === 0) {
                feedbackDor = `*Sem dor* — Ótimo! Anotado. 📋\n\n`;
            } else {
                feedbackDor = `*${dor}/10* — Anotado! 📋\n\n`;
            }

            await send(from,
                `${feedbackDor}` +
                `Para finalizar: tem alguma informação importante que queira acrescentar? ` +
                `Por exemplo: *alergias a medicamentos*, remédios que usa atualmente, ou qualquer detalhe relevante.\n\n` +
                `_Se não houver nada, é só responder "não". 😊_`
            );
            break;
        }

        // ── Informações extras ────────────────────────────────────
        case ETAPA.EXTRAS: {
            const r = body.trim().toLowerCase();
            dados.extras = /^(n[aã]o|nada|nenhum[a]?|sem|-)$/.test(r)
                ? 'Nenhuma'
                : body.trim();

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

        // ── Confirmação final ─────────────────────────────────────
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

// ─── Eventos do WhatsApp ──────────────────────────────────────

client.on('qr', (qr) => {
    console.log('\n📱 Escaneie o QR Code com o WhatsApp:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('🤖 Bot online! Pronto para atender pacientes.');
    if (!NUMERO_SECRETARIA) {
        console.warn(
            '⚠️  AVISO: variável NUMERO_SECRETARIA não configurada.\n' +
            '   Os relatórios serão exibidos apenas no console.\n' +
            '   Defina: NUMERO_SECRETARIA=5511999999999 (somente números, sem +)'
        );
    }
});

client.on('message', async (msg) => {
    if (msg.from.includes('@g.us')) return;          // ignora grupos
    if (msg.from === 'status@broadcast') return;     // ignora status

    const from = msg.from;
    const body = (msg.body || '').trim();

    if (!body) return;

    try {
        if (!sessions[from]) {
            await iniciarConversa(from);
        } else {
            await processarMensagem(from, body);
        }
    } catch (err) {
        console.error(`❌ Erro ao processar mensagem de ${from}:`, err.message);
    }
});

client.initialize().catch(err => console.error('❌ Erro fatal ao inicializar:', err));
