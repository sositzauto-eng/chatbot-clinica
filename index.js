const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log("Iniciando o bot da clinica no Railway...");

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--single-process'
        ],
        // No Railway com Nixpacks, o caminho geralmente é este:
        executablePath: '/usr/bin/google-chrome'
    }
});

const sessions = {};
const questions = [
    { key: "nome", text: "Olá! Sou o assistente virtual da clínica. Para começarmos, qual o seu *nome completo*?" },
    { key: "idade", text: "Prazer, {{nome}}! Qual a sua *idade*?" },
    { key: "especialidade", text: "Qual *especialidade* você procura hoje?" },
    { key: "dor", text: "De 0 a 10, qual seu nível de *dor*?" }
];

function cleanName(input) {
    let text = input.toLowerCase();
    const noise = ["bom dia", "boa tarde", "boa noite", "olá", "oi", "meu nome é"];
    noise.forEach(word => text = text.replace(word, ""));
    return text.trim().split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || input;
}

client.on('qr', (qr) => {
    console.log('--- QR CODE GERADO ABAIXO ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('Bot da Clínica está Online!'));

client.on('message', async msg => {
    const from = msg.from;
    if (from.includes('@g.us')) return;

    if (!sessions[from]) {
        sessions[from] = { step: 0, data: {} };
        await client.sendMessage(from, questions[0].text);
        return;
    }

    let user = sessions[from];
    if (user.step < questions.length) {
        if (questions[user.step].key === "nome") user.data.nome = cleanName(msg.body);
        else user.data[questions[user.step].key] = msg.body;

        user.step++;
        if (user.step < questions.length) {
            await client.sendMessage(from, questions[user.step].text.replace('{{nome}}', user.data.nome));
        } else {
            const r = user.data;
            const resumo = `*RESUMO*\nNome: ${r.nome}\nIdade: ${r.idade}\nEspecialidade: ${r.especialidade}\nDor: ${r.dor}/10`;
            await client.sendMessage(from, resumo);
            await client.sendMessage(from, "Recebemos seus dados!");
            delete sessions[from];
        }
    }
});

client.initialize().catch(err => {
    console.error("Erro fatal ao iniciar:", err.message);
});
