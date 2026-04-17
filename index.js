const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const puppeteer = require('puppeteer');

console.log("🚀 Iniciando chatbot da clínica...");

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // O segredo: deixa o puppeteer achar o próprio executável instalado no postinstall
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote'
        ]
    }
});

const sessions = {};
const questions = [
    { key: "nome", text: "Olá! Sou o assistente virtual da clínica. Qual seu *nome completo*?" },
    { key: "idade", text: "Qual a sua *idade*?" },
    { key: "especialidade", text: "Qual *especialidade* você procura?" },
    { key: "dor", text: "De 0 a 10, qual seu nível de *dor*?" }
];

client.on('qr', (qr) => {
    console.log('✅ QR CODE PRONTO:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('🤖 Bot Online e pronto para atender!'));

client.on('message', async msg => {
    if (msg.from.includes('@g.us')) return;

    if (!sessions[msg.from]) {
        sessions[msg.from] = { step: 0, data: {} };
        await client.sendMessage(msg.from, questions[0].text);
        return;
    }

    const user = sessions[msg.from];
    user.data[questions[user.step].key] = msg.body;
    user.step++;

    if (user.step < questions.length) {
        await client.sendMessage(msg.from, questions[user.step].text);
    } else {
        const r = user.data;
        const resumo = `*NOVO AGENDAMENTO*\n\n*Paciente:* ${r.nome}\n*Idade:* ${r.idade}\n*Especialidade:* ${r.especialidade}\n*Nível de Dor:* ${r.dor}/10`;
        await client.sendMessage(msg.from, resumo);
        await client.sendMessage(msg.from, "Obrigado! Um atendente humano finalizará seu contato em instantes.");
        delete sessions[msg.from];
    }
});

client.initialize().catch(err => console.error("❌ Erro fatal:", err));
