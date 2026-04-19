const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const http = require('http');
const path = require('path');

console.log("🚀 Iniciando chatbot da clínica...");

// ─────────────────────────────────────────────────────────────
//  CONFIGURAÇÃO — variáveis de ambiente no Railway
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

// ─── CLIENTE WHATSAPP (Ajustado para Estabilidade e @LID) ─────
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(process.cwd(), '.wwebjs_auth')
    }),
    // CORREÇÃO 1: Cache de versão para evitar erro de "Versão Antiga"
    webVersionCache: {
        type: 'remote',
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
            // CORREÇÃO 2: User-Agent real para evitar "Não foi possível conectar" no celular
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ]
    }
});

// ─── LÓGICA DE SESSÕES E ETAPAS (Sua lógica original) ─────────
const ETAPA = {
    NOME: 'nome',
    IDADE: 'idade',
    ESPECIALIDADE: 'especialidade',
    QUEIXA: 'queixa',
    CONVENIO: 'convenio',
    CONVENIO_QUAL: 'convenio_qual',
    DOR: 'dor',
    EXTRAS: 'extras',
    CONFIRMACAO: 'confirmacao'
};

const sessions = {};

// ─── FUNÇÕES AUXILIARES ───
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function send(to, text) {
    await delay(1000); 
    try {
        await client.sendMessage(to, text);
    } catch (err) {
        console.error(`❌ Erro ao enviar para ${to}:`, err);
    }
}

function formatarTelefone(from) {
    return from.split('@')[0];
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

// ─── FLUXO DE ATENDIMENTO (Sua lógica original) ──────────────
async function iniciarConversa(from) {
    sessions[from] = { etapa: ETAPA.NOME, dados: {} };
    await send(from, 
        `Olá! 👋 Bem-vindo(a) à nossa clínica.\n\n` +
        `Sou o assistente digital da *Nexora AI* e vou te ajudar com o pré-atendimento.\n\n` +
        `Para começar, qual o seu *nome completo*?`
    );
}

async function finalizarAtendimento(from, dados) {
    const telefone = formatarTelefone(from);
    const prioridade = avaliarPrioridade(dados.dor);

    const relatorio = 
        `🏥 *NOVO PRÉ-ATENDIMENTO*\n` +
        `⚡ *Prioridade:* ${prioridade}\n\n` +
        `👤 *Paciente:* ${dados.nome}\n` +
        `🎂 *Idade:* ${dados.idade} anos\n` +
        `📱 *WhatsApp:* +${telefone}\n` +
        `🩺 *Especialidade:* ${dados.especialidade}\n` +
        `📝 *Queixa:* ${dados.queixa}\n` +
        `💳 *Convênio:* ${dados.convenio}\n` +
        `🚨 *Nível de Dor:* ${dados.dor}/10\n` +
        `➕ *Extras:* ${dados.extras || 'Nenhum'}\n\n` +
        `--- _Powered by Nexora AI_ ---`;

    if (NUMERO_SECRETARIA) {
        await client.sendMessage(`${NUMERO_SECRETARIA}@c.us`, relatorio);
    }

    await send(from, `✅ *Pronto!* Seus dados foram encaminhados.\n\nEm breve nossa equipe entrará em contato para agendar o horário. Obrigado!`);
    delete sessions[from];
}

async function processarMensagem(from, body) {
    const session = sessions[from];
    const { etapa, dados } = session;

    switch (etapa) {
        case ETAPA.NOME:
            if (body.split(' ').length < 2) {
                return send(from, 'Por favor, informe seu nome e sobrenome para o cadastro.');
            }
            dados.nome = body.trim();
            session.etapa = ETAPA.IDADE;
            await send(from, `Prazer, ${primeiroNome(dados.nome)}! Qual a sua *idade*?`);
            break;

        case ETAPA.IDADE:
            const idade = parseInt(body);
            if (isNaN(idade)) return send(from, 'Por favor, responda apenas com números.');
            dados.idade = idade;
            session.etapa = ETAPA.ESPECIALIDADE;
            await send(from, `Qual *especialidade* você procura? (Ex: Clínico Geral, Ortopedia, Pediatria...)`);
            break;

        case ETAPA.ESPECIALIDADE:
            dados.especialidade = body.trim();
            session.etapa = ETAPA.QUEIXA;
            await send(from, `O que você está sentindo? Descreva brevemente seus sintomas.`);
            break;

        case ETAPA.QUEIXA:
            dados.queixa = body.trim();
            session.etapa = ETAPA.CONVENIO;
            await send(from, `Você possui convênio médico?\n1. Sim\n2. Não (Particular)`);
            break;

        case ETAPA.CONVENIO:
            if (body === '1' || body.toLowerCase().includes('sim')) {
                session.etapa = ETAPA.CONVENIO_QUAL;
                await send(from, `Qual o nome do seu convênio?`);
            } else {
                dados.convenio = 'Particular';
                session.etapa = ETAPA.DOR;
                await send(from, `Em uma escala de 0 a 10, qual o seu nível de dor ou desconforto agora?`);
            }
            break;

        case ETAPA.CONVENIO_QUAL:
            dados.convenio = body.trim();
            session.etapa = ETAPA.DOR;
            await send(from, `Certo. E de 0 a 10, qual seu nível de dor agora?`);
            break;

        case ETAPA.DOR:
            dados.dor = body.trim();
            session.etapa = ETAPA.EXTRAS;
            await send(from, `Alguma observação adicional que queira relatar? (Se não tiver, digite "Não")`);
            break;

        case ETAPA.EXTRAS:
            dados.extras = body.trim();
            await finalizarAtendimento(from, dados);
            break;
    }
}

// ─── EVENTOS DO CLIENTE ───
client.on('qr', (qr) => {
    console.log('\n============================================');
    console.log('📱 ESCANEIE O QR CODE ABAIXO COM O WHATSAPP');
    console.log('============================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    clientReady = true;
    console.log('🤖 Bot ONLINE! Pronto para atender (@lid e @c.us).');
});

client.on('message', async (msg) => {
    // CORREÇÃO 3: Captura do ID de forma dinâmica para suportar o novo padrão @lid
    if (msg.from.includes('@g.us') || msg.fromMe || msg.from === 'status@broadcast') return;

    const from = msg.from;
    const body = (msg.body || '').trim();
    if (!body) return;

    console.log(`📩 Mensagem de ${from}: "${body}"`);

    try {
        if (!sessions[from]) {
            await iniciarConversa(from);
        } else {
            await processarMensagem(from, body);
        }
    } catch (err) {
        console.error('❌ Erro no fluxo:', err);
    }
});

client.initialize();
