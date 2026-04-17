const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log("Iniciando o sistema... Aguarde o carregamento do navegador.");

// Configuração robusta para rodar no Railway sem travar
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
        // Tenta encontrar o Chrome no caminho do Railway ou no padrão Linux
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable'
    }
});

// Banco de dados em memória para gerenciar múltiplos pacientes
const sessions = {};

// Fluxo de perguntas da clínica
const questions = [
    { key: "nome", text: "Olá! Sou o assistente virtual da clínica. Para começarmos, qual o seu *nome completo*?" },
    { key: "idade", text: "Prazer, {{nome}}! Qual a sua *idade*?" },
    { key: "convenio", text: "Você possui *convênio médico* ou seria atendimento particular?" },
    { key: "especialidade", text: "Qual *especialidade* ou tipo de consulta você procura hoje?" },
    { key: "dor", text: "Em uma escala de 0 a 10, qual o nível da sua *dor ou desconforto* atual?" },
    { key: "historico", text: "Para finalizar: Você possui alguma doença crônica, alergia ou faz uso de medicação contínua?" }
];

// Função para limpar saudações e isolar o nome do paciente
function cleanName(input) {
    let text = input.toLowerCase();
    const noise = ["bom dia", "boa tarde", "boa noite", "olá", "ola", "oi", "meu nome é", "me chamo", "sou o", "sou a"];
    noise.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        text = text.replace(regex, "");
    });
    text = text.replace(/[,\.\-\!\?]/g, "").trim();
    return text.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || input;
}

// Geração do QR Code nos logs
client.on('qr', (qr) => {
    console.log('----------------------------------------------------');
    console.log('QR CODE GERADO! ESCANEIE COM SEU WHATSAPP AGORA:');
    qrcode.generate(qr, { small: true });
    console.log('----------------------------------------------------');
});

client.on('ready', () => {
    console.log('TUDO PRONTO! O bot está online e respondendo.');
});

// Lógica de conversa
client.on('message', async msg => {
    const from = msg.from;
    
    // Ignora grupos para não gastar memória
    if (from.includes('@g.us')) return;

    if (!sessions[from]) {
        sessions[from] = { step: 0, data: {} };
        await client.sendMessage(from, questions[0].text);
        return;
    }

    let user = sessions[from];
    let step = user.step;

    // Salva a resposta
    if (questions[step].key === "nome") {
        user.data.nome = cleanName(msg.body);
    } else {
        user.data[questions[step].key] = msg.body;
    }

    user.step++;
    
    if (user.step < questions.length) {
        // Envia a próxima pergunta
        let nextMsg = questions[user.step].text.replace('{{nome}}', user.data.nome);
        setTimeout(async () => {
            await client.sendMessage(from, nextMsg);
        }, 1000);
    } else {
        // Finaliza e gera o resumo
        const r = user.data;
        let urgencia = parseInt(r.dor) >= 8 ? "ALTA 🚨" : "NORMAL";

        const resumo = `*NOVO PRÉ-ATENDIMENTO*\n` +
                       `Paciente: ${r.nome}\n` +
                       `Especialidade: ${r.especialidade}\n` +
                       `Dor: ${r.dor}/10\n` +
                       `Prioridade: ${urgencia}`;

        await client.sendMessage(from, resumo);
        await client.sendMessage(from, `Obrigado, ${r.nome}. Recebemos seus dados e logo entraremos em contato.`);
        delete sessions[from];
    }
});

// Inicializa o robô
client.initialize().catch(err => console.error("Erro na inicialização:", err));
