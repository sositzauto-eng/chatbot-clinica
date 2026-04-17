const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Inicializa o cliente com configurações para Servidor (Railway/Linux)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
});

// Banco de dados temporário (em memória) para os atendimentos ativos
const sessions = {};

const questions = [
    { key: "nome", text: "Olá! Sou o assistente virtual da clínica. Para começarmos, qual o seu *nome completo*?" },
    { key: "idade", text: "Prazer, {{nome}}! Qual a sua *idade*?" },
    { key: "whatsapp", text: "Confirma para mim o seu melhor número de *WhatsApp com DDD*?" },
    { key: "convenio", text: "Você possui *convênio médico* ou seria atendimento particular?" },
    { key: "especialidade", text: "Qual *especialidade* ou médico você procura hoje?" },
    { key: "motivo", text: "Entendi. Pode descrever brevemente o *motivo da consulta* ou o que está sentindo?" },
    { key: "dor", text: "Em uma escala de 0 a 10, qual o nível da sua *dor ou desconforto* no momento?" },
    { key: "anamnese", text: "Para finalizar o pré-atendimento: Possui alguma doença crônica, alergia ou faz uso de medicação contínua?" }
];

// Função Inteligente: Extrai o nome e limpa "ruídos" de saudação
function cleanName(input) {
    let text = input.toLowerCase();
    const noise = [
        "bom dia", "boa tarde", "boa noite", "olá", "ola", "oi", "oie",
        "meu nome é", "meu nome e", "me chamo", "sou o", "sou a", "aqui é o", "aqui é a"
    ];

    noise.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        text = text.replace(regex, "");
    });

    // Remove pontuação e espaços extras
    text = text.replace(/[,\.\-\!\?]/g, "").trim();

    // Capitaliza (Adonias Sadda)
    return text.split(" ")
               .filter(part => part.length > 0)
               .map(word => word.charAt(0).toUpperCase() + word.slice(1))
               .join(" ") || input;
}

// Evento: Gerar QR Code nos Logs do Railway
client.on('qr', (qr) => {
    console.log('--- ESCANEIE O QR CODE ABAIXO ---');
    qrcode.generate(qr, { small: true });
});

// Evento: Bot Pronto
client.on('ready', () => {
    console.log('Assistente Virtual da Clínica está ONLINE!');
});

// Evento: Receber Mensagem
client.on('message', async msg => {
    const from = msg.from;
    const text = msg.body;

    // Ignora mensagens de grupos
    if (from.includes('@g.us')) return;

    // Se não houver sessão ativa, inicia do zero
    if (!sessions[from]) {
        sessions[from] = { step: 0, data: {} };
        await client.sendMessage(from, questions[0].text);
        return;
    }

    let userSession = sessions[from];
    let currentStep = userSession.step;

    // Salva a informação baseada no passo atual
    const currentKey = questions[currentStep].key;
    if (currentKey === "nome") {
        userSession.data.nome = cleanName(text);
    } else {
        userSession.data[currentKey] = text;
    }

    // Avança para o próximo passo
    userSession.step++;
    const nextStep = userSession.step;

    if (nextStep < questions.length) {
        // Envia a próxima pergunta
        let nextMsg = questions[nextStep].text.replace('{{nome}}', userSession.data.nome);
        setTimeout(async () => {
            await client.sendMessage(from, nextMsg);
        }, 1000);
    } else {
        // Finaliza e gera o relatório
        await finishFlow(from, userSession.data);
        delete sessions[from]; // Limpa a memória
    }
});

async function finishFlow(chatId, data) {
    // Lógica de Triagem por dor
    let prioridade = "NORMAL";
    const dor = parseInt(data.dor);
    if (dor >= 8) prioridade = "ALTA 🚨 (Urgência)";
    else if (dor >= 5) prioridade = "MÉDIA ⚠️ (Prioritário)";

    const resumo = `*RESUMO PRÉ-ATENDIMENTO*\n` +
                   `----------------------------\n` +
                   `👤 *Paciente:* ${data.nome}\n` +
                   `🎂 *Idade:* ${data.idade}\n` +
                   `📞 *WhatsApp:* ${data.whatsapp}\n` +
                   `💳 *Convênio:* ${data.convenio}\n` +
                   `🩺 *Especialidade:* ${data.especialidade}\n` +
                   `📝 *Motivo:* ${data.motivo}\n` +
                   `🌡️ *Nível de Dor:* ${data.dor}/10\n` +
                   `💊 *Histórico:* ${data.anamnese}\n` +
                   `----------------------------\n` +
                   `📊 *PRIORIDADE:* ${prioridade}`;

    await client.sendMessage(chatId, resumo);
    await client.sendMessage(chatId, `Obrigado, *${data.nome}*. Seus dados foram enviados para nossa secretária. Entraremos em contato em instantes para confirmar o horário.`);
}

// Inicialização
client.initialize();
