export const ONBOARDING_VERSION = 1;
export const AMIA_INTRO_AUDIO = 'https://mysecondself.app/wp-content/uploads/2026/10/MSS-Intro.mp3?v=20261104-113624';

export function onboardingPages(companion = 'your future robot') {
  return [
    { title: 'Meet ' + companion, lead: 'Your future robot should already know you.', paragraphs: [
      'MySecondSelf helps you teach a future robot about your life before it arrives. You do not need to own a robot or pay to begin.',
      'Create your personal profile, then start for free in Chat. Your conversations help build a Persona Passport containing your routines, preferences and boundaries.'
    ] },
    { title: 'How training works', lead: 'Teach the details that make life yours.', paragraphs: [
      'Your robot guides you through everyday situations, from household routines to meeting people outside your home. Each question helps it learn what matters to you and when it should ask, wait or stop.',
      'Answer at your own pace. You can skip a question, explain an exception or correct something. Your learning is saved for you to review and improve.'
    ] },
    { title: 'Your journey, your pace', lead: 'Start free in Chat. Talk when you subscribe.', paragraphs: [
      'Chat starts free with $0.10 in one-time AI usage, not a timed trial. You can see your remaining allowance in Profile.',
      'Premium costs $9.99/month: 60 voice minutes and $0.50 of AI conversation usage. When AI credit runs out, Chat and Talk pause until renewal or you buy a voice-minute pack, which adds another $0.50 in chat credit.',
      'Both modes build your Passport. Use Finish for now to return to your unanswered question. Scenarios cover home life and outings.'
    ] },
    { title: 'Robot Rewards', lead: 'Teach your future robot. Get rewarded for getting ready!', paragraphs: [
      'Every $1 of eligible spending on MySecondSelf subscriptions or voice-minute packs earns $2 in Robot Rewards credit toward a participating robot purchase. Free Chat is a way to start learning; qualifying paid purchases unlock rewards.',
      'We are working with robot partners to offer trained, Robot Ready members priority purchase opportunities as participating robots become available.',
      'Actual discounts and priority opportunities depend on programme limits and partner availability. See Robot Rewards for full terms and conditions.'
    ] },
    { title: 'What happens next?', lead: 'Your Persona Passport is what you are building.', paragraphs: [
      'Your preferences and boundaries build your Persona Passport. Review your training progress, modules and saved learning whenever you like.',
      'Robot simulations and physical integrations are future stages. No robot is connected today; any transfer will require verified compatibility and your permission.',
      'Share only what you choose. You can edit or remove saved learning and manage optional shared learning in Privacy settings.'
    ] }
  ];
}

export const FAQ_CATEGORIES = [
  { id: 'understanding', title: 'Understanding MySecondSelf', questions: [
    { id: 'what-is-mss', question: 'What is MySecondSelf?', answer: 'MySecondSelf helps you prepare a personalisation profile for a future domestic robot. Through guided conversations, you describe your preferences, routines, exceptions, boundaries and permissions. The profile you are building is your Persona Passport.' },
    { id: 'own-robot', question: 'Do I need to own a robot?', answer: 'No. You can begin before you own a robot. The current app builds and reviews your personalisation profile. It does not connect to or control a physical robot.' },
    { id: 'chatbot', question: 'Is this another chatbot?', answer: 'Conversation is the interface, but the purpose is to build structured understanding of your life. Scenarios help explore preferences, exceptions and boundaries, and you can review the learning that has been saved. A friendly reply is not proof that a preference was saved or that a robot can perform an action.' },
    { id: 'personal-questions', question: 'Why does it ask personal questions?', answer: 'A useful future robot needs context: how you like something done, when the usual rule changes, and what it may or may not do. You can ask why a question matters, decline it, or give a less personal example. Do not share passwords, access codes, payment-card details or other secrets.' }
  ] },
  { id: 'training', title: 'Training your robot', questions: [
    { id: 'duration', question: 'How long does training take?', answer: 'There is no minimum session length or deadline. Work on one small task for a few minutes, then use Finish for now when you want to stop. A whole module may take several visits. Useful detail and review matter more than time spent.' },
    { id: 'scenarios', question: 'Why is training divided into rooms and scenarios?', answer: 'A scenario gives the conversation a practical focus, so important preferences and boundaries are easier to explore and review. The journey currently contains 26 modules covering home life, people, outings and safety. Modules contain smaller learning areas; they are not a fixed questionnaire.' },
    { id: 'no-garden', question: 'What if I do not have a garden or a particular room?', answer: 'The scenario may still help prepare for visiting someone else or encountering that situation outside your home. Tell your robot whether you want to discuss a visit, a hypothetical example, or something that is not relevant. You do not need to invent a room or preference.' },
    { id: 'change-answers', question: 'Can I change an answer or correct saved learning?', answer: 'Yes. Tell your robot what has changed, and review the resulting saved preference. You can also open the relevant module to review or edit learning and resolve conflicting information. Check that important conditions and permissions still say what you mean.' },
    { id: 'resume', question: 'How do I stop and return later?', answer: 'Use Finish for now in Chat or Talk to save your conversation and a visit checkpoint, then review the recap. Home’s next-step card prioritises the question left unanswered. Continue talking opens Talk without starting the microphone; press Start when you are ready. Chat remains available for text. If saving fails, keep the page open and use Retry saving.' }
  ] },
  { id: 'passport', title: 'Persona Passport', questions: [
    { id: 'stored', question: 'What goes into my Persona Passport?', answer: 'Your account can hold conversation history and saved preferences, routines, conditions, exceptions, boundaries and permissions. Some details may still be awaiting clarification or confirmation. Your Passport is the personalisation profile you are building, rather than evidence of a physical robot’s abilities.' },
    { id: 'review-learning', question: 'Where can I see what has been learned?', answer: 'Open Passport for your progress and training modules. Inside a module, review the linked learning and its conditions. Your saved preferences provides another way to inspect what you have shared. Visit recaps show relevant learning saved during that visit and identify when learning is still syncing.', action: 'passport' },
    { id: 'progress', question: 'Why can a bar move while my Passport still says 0%?', answer: 'The Chat and Talk bars show areas explored within the current module. Reviewed areas are a separate measure. Passport’s overall percentage counts whole modules that you have explicitly reviewed and confirmed complete. Saving one preference, discussing an area, or finishing a visit does not automatically complete a module.' },
    { id: 'finish-module', question: 'What happens when I finish a module or the whole journey?', answer: 'Review the module’s learning, resolve outstanding clarification, and use its completion review. Completing a module unlocks the next one, and you can revisit earlier learning. Completing the journey does not automatically connect a robot, prove physical readiness, or guarantee reward redemption or hardware availability.' }
  ] },
  { id: 'conversation', title: 'Talk, Chat and payments', questions: [
    { id: 'talk-chat', question: 'What is the difference between Talk and Chat?', answer: 'Talk is a spoken conversation using your microphone and the robot’s voice. It waits for you to press Start and provides mute and pause controls. Chat uses typed messages. Both use the same signed-in account, saved conversation and training journey.' },
    { id: 'free-chat', question: 'Can I start using MySecondSelf without paying?', answer: 'Yes. Create your account and start in Chat. Your one-time free allowance includes $0.10 of DeepSeek AI usage; it is not a fixed number of minutes or daily allowance. The amount of conversation it provides varies with the questions and processing required. Voice requires Premium. Your saved training remains yours when the free allowance ends.' },
    { id: 'premium-chat', question: 'How much AI chat is included with Premium?', answer: 'Premium is $9.99 per month and includes $0.50 of AI conversation usage plus 60 voice minutes per billing period. Once the AI usage allowance is exhausted, both Chat and Talk pause until the subscription renews or a verified voice-minute pack adds $0.50 of chat credit for the current billing period. A voice pack also adds its advertised voice minutes. Actual usage depends on the complexity and length of conversations.' },
    { id: 'voice-minutes', question: 'How do voice minutes work?', answer: 'Talk is available with an active Premium subscription, available voice minutes and remaining AI conversation credit. Premium includes 60 voice minutes per subscription month; voice-minute packs add more. Voice time and DeepSeek conversation usage are tracked separately. Chat does not consume voice minutes.' },
    { id: 'balance-reset', question: 'Where can I see my balance and reset date?', answer: 'Open Profile to see the remaining free Chat credit, or your Premium AI usage allowance, voice minutes, voice top-ups and renewal date. Subscription voice minutes are used before voice top-ups. Purchased voice minutes remain on the account, but require active Premium and AI allowance to use. Complimentary test minutes are not a paid subscription or automatic renewal.' },
    { id: 'out-of-minutes', question: 'What happens if my voice minutes run out?', answer: 'When voice minutes reach zero but Premium AI chat credit remains, switch to Chat to continue. Voice-minute packs add voice minutes and $0.50 in chat credit. If the Premium AI usage allowance is exhausted, both Chat and Talk pause until renewal or an eligible pack purchase. Your saved training and persona are not erased.' },
    { id: 'audio-intro', question: 'Can I hear the introduction again?', answer: 'Yes. Replay the introduction in Help & Getting Started opens step 1 and plays the recording from the beginning. You can also open How it works on Home and choose Listen to your robot on step 1; the button uses your robot’s name. Playing the recording does not start a Talk session or activate the microphone.', action: 'guide' }
  ] },
  { id: 'future', title: 'Robots, rewards and privacy', questions: [
    { id: 'compatible-robots', question: 'Which robots will work with my Passport?', answer: 'Physical robot transfer and control are future development stages. Featuring a manufacturer or robot in the app does not mean that it is connected or compatible today. Verified models, supported capabilities, availability and any transfer process will be explained as integrations become available.' },
    { id: 'simulation', question: 'Are simulations and physical robot tests already available?', answer: 'Some training modules offer hypothetical situation previews based on saved learning. Those are conversation-based examples, not hardware simulations or physical robot tests. Hardware simulation, verified compatibility and physical robot integration remain future development work.' },
    { id: 'rewards', question: 'How do Robot Rewards work?', answer: 'Robot Rewards is an additional promotional incentive, not the core purpose of training. Current terms describe $2 credit for each $1 of eligible verified USD spending, capped at $100 per UTC month and $1,000 earned per account. Redemption also has eligibility and partner limits, including a 5% hardware-price cap. Free test minutes and test purchases do not earn qualifying rewards. Read the full current terms in Robot Rewards; an earned balance does not reserve a robot or guarantee redemption.', action: 'rewards' },
    { id: 'privacy', question: 'Who can access my information?', answer: 'Your learning is associated with your signed-in account. MySecondSelf and the services used to provide the app process information needed for conversation, storage and support. Optional anonymised shared learning is controlled in Privacy settings. Do not treat a conversation as a place to store passwords or other secrets. Use the published privacy information or contact support for specific data-handling questions.', action: 'privacy' },
    { id: 'delete-learning', question: 'Can I remove learning or ask for my data to be deleted?', answer: 'You can review and remove saved learning, reset an individual scenario, or use Reset All Training in Settings. Read the confirmation carefully: a training reset removes training data and is separate from cancelling a subscription or deleting an account. Contact support for account-deletion or other privacy requests.', action: 'support' }
  ] }
];

export function searchFaq(query) {
  const normalise = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const terms = normalise(query).trim().split(/\s+/).filter(Boolean);
  return FAQ_CATEGORIES.map(category => ({ ...category, questions: category.questions.filter(item => terms.every(term => normalise(category.title + ' ' + item.question + ' ' + item.answer).includes(term))) })).filter(category => category.questions.length);
}

export function shouldShowOnboarding(record, { profileReady = false, returning = false } = {}) {
  return Boolean(profileReady && !returning && record && record.version === 0 && record.outcome === 'pending');
}

export function firstConversationGuidance(enabled) {
  return enabled === true ? 'FIRST CONVERSATION INTRODUCTION: In the selected conversation language, naturally explain in two or three short sentences that I am learning the owner’s preferences, routines, exceptions and boundaries for a future robot, a little at a time. MySecondSelf is building their Persona Passport; no physical robot is connected today. A light, friendly aside is welcome. Then begin or continue the current scenario with just one useful question. Do not promise hardware compatibility, transfers or physical actions. Do not repeat this product explanation later in the conversation.' : '';
}
