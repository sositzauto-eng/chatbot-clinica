const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log("🚀 Iniciando chatbot da clínica...");

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    }
});

const sessions = {};

const questions = [
    {
        key: "nome",
        text: "Olá 😊 Sou o assistente virtual da clínica.\nPara começarmos, qual seu *nome completo*?"
    },
    {
        key: "idade",
        text: "Prazer, {{nome}}! Qual sua *idade*?"
    },
    {
        key: "especialidade",
        text: "Qual *especialidade médica* você procura hoje?"
    },
    {
        key: "dor",
        text: "De 0 a 10, qual seu nível de *dor ou incômodo*?"
    }
];

function cleanName(input) {
    let text = input.toLowerCase();

    const remover = [
        "bom dia",
        "boa tarde",
        "boa noite",
        "olá",
        "ola",
        "oi",
        "meu nome é",
        "me chamo",
        "sou o",
        "sou a"
    ];

    remover.forEach(item => {
        text = text.replace(item, "");
    });

    text = text.replace(/[^\p{L}\s]/gu, "").trim();

    if (!text) return "Paciente";

    return text
        .split(" ")
        .filter(p => p.length > 1)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
}

client.on('qr', qr => {
    console.log("📲 Escaneie o QR Code abaixo:");
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log("✅ Bot online com sucesso!");
});

client.on('authenticated', () => {
    console.log("🔐 WhatsApp autenticado.");
});

client.on('auth_failure', msg => {
    console.log("❌ Falha na autenticação:", msg);
});

client.on('disconnected', reason => {
    console.log("⚠️ Bot desconectado:", reason);
});

client.on('message', async msg => {
    try {
        const from = msg.from;

        if (from.includes('@g.us')) return;
        if (!msg.body) return;

        const texto = msg.body.trim();

        if (!sessions[from]) {
            sessions[from] = {
                step: 0,
                data: {}
            };

            await client.sendMessage(from, questions[0].text);
            return;
        }

        const user = sessions[from];
        const current = questions[user.step];

        if (current.key === "nome") {
            user.data.nome = cleanName(texto);
        } else {
            user.data[current.key] = texto;
        }

        user.step++;

        if (user.step < questions.length) {
            let nextQuestion = questions[user.step].text;

            nextQuestion = nextQuestion.replace(
                "{{nome}}",
                user.data.nome || "Paciente"
            );

            await client.sendMessage(from, nextQuestion);
        } else {
            const r = user.data;

            const resumo =
`📋 *PRÉ-ATENDIMENTO CONCLUÍDO*

👤 Nome: ${r.nome}
🎂 Idade: ${r.idade}
🏥 Especialidade: ${r.especialidade}
📈 Dor: ${r.dor}/10

✅ Recebemos seus dados.
Nossa equipe dará continuidade ao atendimento.`;

            await client.sendMessage(from, resumo);

            delete sessions[from];
        }

    } catch (error) {
        console.log("❌ Erro ao responder mensagem:", error.message);
    }
});

client.initialize().catch(err => {
    console.log("❌ Erro fatal ao iniciar:", err.message);
});
