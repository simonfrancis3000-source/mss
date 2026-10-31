const WELCOME_TEMPLATES = Object.freeze({
  en: "I am your future robot, {companion}. I am here to help you build your SecondSelf and understand how you like life to work, at home and out in the world.",
  es: "Soy tu futuro robot, {companion}. Estoy aquí para ayudarte a crear tu SecondSelf y entender cómo te gusta vivir, en casa y fuera de ella.",
  fr: "Je suis ton futur robot, {companion}. Je suis là pour t'aider à créer ton SecondSelf et à comprendre comment tu aimes vivre, chez toi et dans le monde extérieur.",
  it: "Sono il tuo futuro robot, {companion}. Sono qui per aiutarti a creare il tuo SecondSelf e capire come ti piace vivere, a casa e fuori.",
  pt: "Sou o teu futuro robô, {companion}. Estou aqui para te ajudar a criar o teu SecondSelf e perceber como gostas de viver, em casa e fora dela.",
  hi: "मैं आपका भविष्य का रोबोट, {companion}, हूँ। मैं आपका SecondSelf बनाने, आपकी दिनचर्या समझने और यह जानने में मदद करूँगा कि आप काम किस तरह करवाना पसंद करते हैं।",
  ja: "私はあなたの未来のロボット、{companion}です。あなたのSecondSelfを作り、日々の習慣や好みを理解するお手伝いをします。",
  zh: "我是你未来的机器人，{companion}。我会帮助你建立 SecondSelf，了解你的日常习惯和做事偏好。"
});

const LEGACY_WELCOME_MESSAGES = new Set([
  "I am your future robot, {companion}. I am here to help you build your SecondSelf, learn your routines and understand how you like things done.",
  "Soy tu futuro robot, {companion}. Estoy aquí para ayudarte a crear tu SecondSelf, conocer tus rutinas y entender cómo te gusta que se hagan las cosas.",
  "Je suis ton futur robot, {companion}. Je suis là pour t'aider à créer ton SecondSelf, à découvrir tes habitudes et à comprendre comment tu aimes que les choses soient faites.",
  "Sono il tuo futuro robot, {companion}. Sono qui per aiutarti a creare il tuo SecondSelf, conoscere le tue abitudini e capire come preferisci che vengano fatte le cose.",
  "Sou o teu futuro robô, {companion}. Estou aqui para te ajudar a criar o teu SecondSelf, conhecer as tuas rotinas e perceber como gostas que as coisas sejam feitas.",
  "Hi, I’m here to help you build your SecondSelf. Speak naturally, and we’ll work out what matters to you.",
  "Hola, estoy aquí para ayudarte a crear tu SecondSelf. Habla con naturalidad y descubriremos qué es importante para ti.",
  "Bonjour, je suis là pour t’aider à créer ton SecondSelf. Parle naturellement et nous verrons ce qui compte pour toi.",
  "Ciao, sono qui per aiutarti a creare il tuo SecondSelf. Parla liberamente e capiremo cosa conta per te.",
  "Olá, estou aqui para te ajudar a criar o teu SecondSelf. Fala com naturalidade e vamos perceber o que é importante para ti.",
  "नमस्ते, मैं आपका SecondSelf बनाने में मदद करने के लिए यहाँ हूँ। स्वाभाविक रूप से बात करें, ताकि हम समझ सकें कि आपके लिए क्या महत्वपूर्ण है।",
  "こんにちは。あなたのSecondSelfづくりをお手伝いします。自然に話してくれれば、何が大切かを一緒に整理していきます。",
  "你好，我会帮助你建立自己的 SecondSelf。你可以自然地说，我们会一起了解什么对你最重要。",
  "Hi, I’m here to help you build your SecondSelf. Which parts of home life would you like it to understand first?",
  "Hola, estoy aquí para ayudarte a crear tu SecondSelf. ¿Qué aspectos de la vida en casa te gustaría que aprendiera primero?",
  "Bonjour, je suis là pour t’aider à construire ton SecondSelf. Quels aspects de la vie à la maison aimerais-tu que je comprenne en premier ?",
  "Ciao, sono qui per aiutarti a costruire il tuo SecondSelf. Quali aspetti della vita a casa vorresti che imparassi per primi?",
  "Olá, estou aqui para te ajudar a costruir o teu SecondSelf. Que aspetos da vida em casa gostarias que aprendesse primeiro?",
  "नमस्ते, मैं आपका SecondSelf बनाने में मदद करने के लिए यहाँ हूँ। आप चाहेंगे कि मैं घर की दिनचर्या के किन पहलुओं को सबसे पहले समझूँ?",
  "こんにちは。あなたのSecondSelfづくりをお手伝いします。家での暮らしのどんなことを、まず理解してほしいですか？",
  "你好，我来帮你建立自己的 SecondSelf。你希望我先了解家庭生活中的哪些方面？"
]);

export function companionWelcomeMessage(language = "en", companionName = "Freya") {
  const safeName = String(companionName || "Freya").replace(/[\r\n\u0000]/g, "").trim().slice(0, 60) || "Freya";
  const template = WELCOME_TEMPLATES[language] || WELCOME_TEMPLATES.en;
  return template.replace("{companion}", safeName);
}

export function companionThinkingMessage(companionName = "Your robot") {
  const safeName = String(companionName || "Your robot").replace(/[\r\n\u0000]/g, "").trim().slice(0, 60) || "Your robot";
  return safeName + " is thinking…";
}

export function isCompanionWelcomeMessage(value) {
  const message = String(value || "").trim();
  if (LEGACY_WELCOME_MESSAGES.has(message)) return true;
  return Object.values(WELCOME_TEMPLATES).some((template) => {
    const [prefix, suffix] = template.split("{companion}");
    return message.startsWith(prefix) && message.endsWith(suffix);
  });
}
