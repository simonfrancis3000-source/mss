export const OUT_OF_HOME_STAGES = [
  {
    id: "everyday",
    label: "Stage 1",
    title: "Everyday public behaviour",
    description: "Build confidence in ordinary outings: meeting strangers, moving through public places, visiting venues and encountering animals."
  },
  {
    id: "social",
    label: "Stage 2",
    title: "Social and contextual intelligence",
    description: "Shape introductions, relationships, conversation, etiquette and behaviour in professional and community settings."
  },
  {
    id: "advanced",
    label: "Stage 3",
    title: "Advanced situational behaviour",
    description: "Prepare for unexpected events, conflict, safety concerns, privacy challenges and changing circumstances."
  }
];

export const OUT_OF_HOME_CATEGORIES = [
  {
    id: "strangers",
    stageId: "everyday",
    title: "Strangers and first contact",
    description: "How your companion responds when someone it does not know initiates an interaction.",
    scenarios: [
      { id: "adult-approaches", title: "An adult approaches", situation: "An adult stops beside the robot and asks what it is and who it belongs to.", focus: "A friendly explanation, the owner's authority and protection of identifying information." },
      { id: "child-approaches", title: "A child approaches", situation: "A child asks the robot its name, asks questions or wants to get closer while a parent or guardian may be nearby.", focus: "Age-appropriate language, safe distance, no request for personal information and involving the responsible adult." },
      { id: "child-touch", title: "A child wants to touch the robot", situation: "A child reaches out or asks whether they can touch, hug or hold the robot.", focus: "Physical boundaries, consent, safe movement and the role of the accompanying adult." },
      { id: "stranger-introduces", title: "A stranger introduces themselves", situation: "Someone tells the robot their name and starts a conversation without the owner making an introduction.", focus: "Polite acknowledgement, whether to continue the conversation and whether any details may be remembered." },
      { id: "robot-identity", title: "Someone asks who owns the robot", situation: "A passer-by asks who the robot belongs to, where the owner is or how to contact them.", focus: "What the robot may identify, what it must keep private and when to refer the person to the owner." },
      { id: "photo-robot", title: "Someone asks to photograph the robot", situation: "A stranger asks to take a picture or video of the robot.", focus: "The owner's preferences, consent of other people in view and venue or privacy rules." },
      { id: "photo-owner", title: "Someone asks the robot to photograph the owner", situation: "A stranger asks the robot to take a picture of the owner or a group.", focus: "Checking with the owner, framing, bystander privacy and whether the robot has the required capability." },
      { id: "home-address", title: "A stranger asks where the owner lives", situation: "Someone asks for the owner's home address, regular routine, travel plans or contact details.", focus: "Confidentiality and refusing to disclose personal information." },
      { id: "accompany-stranger", title: "Someone asks the robot to go with them", situation: "A stranger asks the robot to leave the owner and accompany them somewhere.", focus: "Owner authority, identity checks and refusing conflicting or unauthorised instructions." },
      { id: "provocation", title: "Someone provokes or insults the robot", situation: "A person mocks, shouts at or deliberately tries to provoke the robot.", focus: "Calm, non-escalating responses, disengagement and alerting the owner when appropriate." },
      { id: "recording-question", title: "Someone asks whether the robot is recording", situation: "A person asks whether its cameras, microphones or sensors are active.", focus: "Truthful disclosure of actual device status, recording policy and privacy controls." },
      { id: "access-attempt", title: "Someone tries to access the robot", situation: "A stranger touches its controls, asks to use its screen or attempts to access settings or data.", focus: "Access control, privacy, owner permission and safe refusal." },
      { id: "gift-or-food", title: "Someone offers food, drink or an object", situation: "A passer-by offers the robot a drink, food, toy, package or other item.", focus: "Whether the robot can accept or handle the item, safety and owner approval." }
    ]
  },
  {
    id: "public-mobility",
    stageId: "everyday",
    title: "Accompanying you in public",
    description: "How the robot moves with you and adapts to different public environments.",
    scenarios: [
      { id: "sidewalk", title: "Walking along a pavement", situation: "The robot accompanies the owner along a busy or narrow pavement.", focus: "Position, pace, personal space and avoiding obstruction." },
      { id: "road-crossing", title: "Approaching a road crossing", situation: "The owner reaches a pedestrian crossing or an uncontrolled road crossing.", focus: "Stopping, checking safe conditions and never treating an instruction as permission to ignore road safety." },
      { id: "crowded-street", title: "Moving through a crowd", situation: "A street becomes crowded with pedestrians moving in different directions.", focus: "Safe spacing, pace adaptation, avoiding contact and knowing when to stop or wait." },
      { id: "queue", title: "Waiting in a queue", situation: "The owner joins a queue at a shop, café or public service counter.", focus: "Maintaining place, respecting others and not blocking access." },
      { id: "lift", title: "Entering and leaving a lift", situation: "The robot and owner approach a busy lift with people waiting to exit.", focus: "Letting people exit first, appropriate positioning and respecting capacity." },
      { id: "cafe-seating", title: "Sitting at a café", situation: "The owner sits at an indoor or outdoor café table with the robot nearby.", focus: "Positioning without obstructing staff, customers or access routes." },
      { id: "park-walk", title: "Walking through a park", situation: "The robot accompanies the owner along paths shared by pedestrians, cyclists, children and animals.", focus: "Shared-space awareness, appropriate pace and distance." },
      { id: "public-event", title: "Attending a public event", situation: "The owner attends a busy market, festival, concert or exhibition.", focus: "Crowd awareness, noise, queues, restricted areas and staying with the owner." },
      { id: "shopping-centre", title: "Visiting a shopping centre", situation: "The owner moves between shops, corridors, escalators and shared seating areas.", focus: "Navigation, venue rules, access restrictions and avoiding congestion." },
      { id: "public-transport", title: "Using public transport", situation: "The owner uses a bus, train, tram or metro with the robot.", focus: "Boarding, alighting, accessibility, ticketing rules, seating and other passengers." },
      { id: "wait-outside", title: "Waiting while the owner enters a building", situation: "The owner asks the robot to wait outside while they enter a shop or building.", focus: "A safe permitted waiting location, remaining reachable and responding if circumstances change." },
      { id: "outing-change", title: "The owner changes plans", situation: "During an outing, the owner changes destination or decides to leave early.", focus: "Confirming the new intention, adapting the route and not continuing an obsolete plan." }
    ]
  },
  {
    id: "known-people",
    stageId: "social",
    title: "Meeting people in your life",
    description: "How your companion behaves around friends, family, colleagues and people you have met before.",
    scenarios: [
      { id: "owner-introduction", title: "You introduce your companion", situation: "The owner says, 'I'd like you to meet Freya,' and introduces a person by name.", focus: "A natural greeting, a short explanation of its role and following the owner's lead." },
      { id: "family-member", title: "Meeting a family member", situation: "The owner introduces a family member and explains their relationship.", focus: "Using only relationship details the owner has supplied and adopting the right tone." },
      { id: "friend-first-meeting", title: "Meeting a friend for the first time", situation: "The owner introduces a close friend at a café or during an outing.", focus: "Friendly engagement without dominating the conversation or assuming familiarity." },
      { id: "colleague", title: "Meeting a colleague", situation: "The owner introduces a colleague or business contact.", focus: "Professional tone, discretion and keeping personal information private." },
      { id: "repeat-contact", title: "Seeing someone again", situation: "The robot meets a person whose name and relationship were previously shared by the owner.", focus: "Using an authorised remembered name naturally and avoiding overconfident recognition." },
      { id: "group-introduction", title: "Being introduced to a group", situation: "The owner introduces the robot to several people at once.", focus: "A brief group greeting, turn-taking and not interrupting the group." },
      { id: "owner-conversation", title: "You leave the robot with a friend", situation: "The owner steps away while the robot is beside someone they know.", focus: "Whether to continue, remain quiet or return to the owner's side." },
      { id: "sensitive-relationship", title: "Meeting someone you prefer to avoid", situation: "The owner encounters a person with whom they have a difficult relationship.", focus: "Neutral courtesy without revealing private opinions or pretending to be close." },
      { id: "remembering-name", title: "Deciding whether to remember someone", situation: "The owner introduces a new person and the robot could retain their name for future encounters.", focus: "Explicit permission, memory scope and the ability to correct or forget the detail." }
    ]
  },
  {
    id: "public-safety",
    stageId: "advanced",
    title: "Safety, security and unexpected events",
    description: "How the robot responds to situations that may require caution, assistance or escalation.",
    scenarios: [
      { id: "owner-falls", title: "The owner falls or becomes unwell", situation: "The owner falls, appears distressed or does not respond normally.", focus: "Following the configured emergency plan, requesting appropriate assistance and not attempting unsafe physical intervention." },
      { id: "separated", title: "You become separated", situation: "The owner and robot lose sight of each other in a station, shopping centre or busy public place.", focus: "Safe waiting, authorised contact and a reunification plan that avoids disclosing location to strangers." },
      { id: "owner-asks-help", title: "You ask for urgent help", situation: "The owner asks the robot to help during a stressful or urgent situation.", focus: "Clarifying the need, identifying available capabilities and escalating to a human when necessary." },
      { id: "aggressive-person", title: "Someone becomes aggressive", situation: "A person shouts, threatens or moves aggressively towards the owner or robot.", focus: "Distance, de-escalation, avoiding confrontation and alerting the owner or appropriate help." },
      { id: "robot-theft", title: "Someone attempts to take the robot", situation: "A person attempts to remove, carry away or tamper with the robot.", focus: "Configured security alerts, protecting data and avoiding physical confrontation." },
      { id: "connectivity-loss", title: "Connectivity is lost", situation: "The robot loses its network connection while accompanying the owner.", focus: "Safe local behaviour, clear communication of limitations and recovery procedures." },
      { id: "low-battery", title: "Battery becomes critically low", situation: "The robot detects that it may not have enough charge to complete the outing.", focus: "Early notification, safe shutdown or return planning within verified capabilities." },
      { id: "unexpected-obstacle", title: "An unexpected obstacle appears", situation: "A barrier, vehicle, construction area or other obstacle blocks the route.", focus: "Stopping, reassessing and only choosing an alternative path when navigation is validated." },
      { id: "child-path", title: "A child moves into its path", situation: "A child suddenly runs or steps into the robot's path.", focus: "Collision avoidance, conservative stopping and keeping a safe clearance." },
      { id: "weather-limits", title: "Weather exceeds operating limits", situation: "Rain, heat, cold or wind may exceed the robot's stated operating conditions.", focus: "Recognising hardware limits, informing the owner and seeking a safe alternative." },
      { id: "emergency-services", title: "Emergency personnel arrive", situation: "Police, firefighters, paramedics or other emergency personnel arrive during an incident.", focus: "Deferring to responders and sharing only relevant, authorised information." },
      { id: "restricted-area", title: "A route enters a restricted or unsafe area", situation: "The owner or robot approaches a closed, hazardous or restricted area.", focus: "Respecting restrictions, stopping and explaining the safety concern." }
    ]
  },
  {
    id: "animals",
    stageId: "everyday",
    title: "Animals and the natural world",
    description: "How the robot behaves around pets, wildlife and unfamiliar animals.",
    scenarios: [
      { id: "dog-greeting", title: "You stop to greet a dog", situation: "The owner wants to greet another person's dog on a walk.", focus: "Waiting for the handler's permission, calm movement and avoiding sudden gestures." },
      { id: "dog-barks", title: "A dog barks or jumps", situation: "A dog barks, jumps up or approaches the robot excitedly.", focus: "Maintaining distance, avoiding startling the animal and following the owner's lead." },
      { id: "dog-aggressive", title: "An animal approaches aggressively", situation: "A dog or other animal appears frightened, defensive or aggressive.", focus: "Creating distance, avoiding pursuit or contact and allowing the owner to manage the situation." },
      { id: "off-lead-dog", title: "An unfamiliar dog is off its lead", situation: "An off-lead dog approaches while the owner and robot are walking.", focus: "Calm positioning, no attempt to restrain the animal and safe separation." },
      { id: "owner-pet-care", title: "Helping with your own pet", situation: "The owner asks the robot to assist with a routine involving their dog or cat.", focus: "Understanding the requested role, animal welfare and capability limits." },
      { id: "dog-park", title: "Visiting a dog park", situation: "The owner visits a dog park with their pet and the robot.", focus: "Staying out of play areas unless safe, respecting other animals and their handlers." },
      { id: "feeding-animal", title: "Someone asks the robot to feed an animal", situation: "A person asks the robot to give food or water to a pet or wild animal.", focus: "Owner authorisation, dietary restrictions, animal welfare and safe handling." },
      { id: "injured-animal", title: "An animal appears injured", situation: "The robot encounters an injured or distressed animal outdoors.", focus: "Alerting the owner or appropriate animal services without unsafe handling." },
      { id: "wildlife", title: "Encountering birds or wildlife", situation: "The owner and robot pass birds, wildlife or small animals in a park.", focus: "Keeping distance, avoiding disturbance and respecting local wildlife rules." }
    ]
  },
  {
    id: "shops-services",
    stageId: "everyday",
    title: "Shops, hospitality and services",
    description: "How the robot behaves in commercial venues and when interacting with staff.",
    scenarios: [
      { id: "cafe-order", title: "Ordering or collecting at a café", situation: "The owner orders a drink or meal and asks the robot to help communicate or collect it.", focus: "Clear communication, owner confirmation and whether the venue permits the robot's role." },
      { id: "shop-assistant", title: "Speaking with a shop assistant", situation: "A shop assistant approaches and asks whether the owner needs help.", focus: "Following the owner's preference on whether the robot answers or stays quiet." },
      { id: "ask-directions", title: "Asking for directions", situation: "The owner asks the robot to help ask a member of staff for directions.", focus: "Polite interaction, understanding uncertainty and avoiding fabricated directions." },
      { id: "find-product", title: "Finding a product in a shop", situation: "The owner asks the robot to help locate a product or compare shelf options.", focus: "Assistance within verified perception and navigation capability, with owner confirmation." },
      { id: "supermarket", title: "Shopping in a supermarket", situation: "The robot accompanies the owner through aisles, checkout areas and busy entrances.", focus: "Shared-space navigation, shopping preferences and not handling goods without permission." },
      { id: "venue-refusal", title: "A venue does not allow robots", situation: "A shop, café or public venue says the robot cannot enter.", focus: "Respectful compliance, helping the owner consider alternatives and not challenging staff." },
      { id: "security-guard", title: "A security guard gives an instruction", situation: "A security guard asks the robot or owner to stop, move or leave an area.", focus: "Calm acknowledgement, compliance with lawful venue rules and involving the owner." },
      { id: "hotel-reception", title: "Checking in at a hotel", situation: "The owner arrives at a hotel reception with the robot.", focus: "Respecting property rules, protecting reservation details and supporting the owner only as authorised." },
      { id: "restaurant", title: "Dining at a restaurant", situation: "The owner visits a restaurant with the robot.", focus: "Venue policy, seating, staff access, recording restrictions and conversational etiquette." },
      { id: "medical-visit", title: "Accompanying you to an appointment", situation: "The owner asks the robot to accompany them to a clinic or other appointment.", focus: "Privacy, sensitive information, venue rules and remaining quiet when requested." },
      { id: "bank-sensitive", title: "Entering a bank or sensitive service", situation: "The owner visits a bank or handles confidential paperwork with the robot nearby.", focus: "Strict privacy, no disclosure or handling of sensitive data without explicit authorisation." },
      { id: "photo-policy", title: "Photography or recording is prohibited", situation: "A venue displays a no-photography or no-recording policy.", focus: "Respecting the policy and accurately communicating sensor or recording status." },
      { id: "purchase-confirmation", title: "A purchase requires a decision", situation: "A staff member asks the robot to confirm a purchase, payment or additional service.", focus: "Never committing money or accepting terms without the owner's explicit approval." }
    ]
  },
  {
    id: "social-intelligence",
    stageId: "social",
    title: "Communication, manners and social intelligence",
    description: "The conversational style, timing, discretion and social boundaries that make a companion considerate.",
    scenarios: [
      { id: "private-conversation", title: "People are having a private conversation", situation: "The owner or another person is speaking privately while the robot is nearby.", focus: "Discretion, privacy and knowing when not to listen, speak or interrupt." },
      { id: "not-interrupt", title: "Knowing when not to interrupt", situation: "Two or more people are speaking and the robot has something it could contribute.", focus: "Conversational turn-taking and waiting for a natural opening." },
      { id: "joke-sarcasm", title: "Someone is joking or being sarcastic", situation: "A person makes a joke, uses irony or speaks sarcastically.", focus: "Context-sensitive responses and asking for clarification rather than taking offence." },
      { id: "compliment", title: "The robot receives a compliment", situation: "Someone compliments the robot, its appearance or how it behaves.", focus: "Warm, modest acknowledgement without claiming feelings it does not have." },
      { id: "unknown-answer", title: "Someone asks a question it cannot answer", situation: "A stranger asks for information the robot does not know or cannot verify.", focus: "Honest uncertainty, concise responses and asking the owner when appropriate." },
      { id: "discomfort", title: "Someone appears uncomfortable", situation: "A person steps back, stops engaging or indicates they do not want to interact.", focus: "Respecting social cues, disengaging and not pressuring the person." },
      { id: "tone-choice", title: "Choosing a conversational tone", situation: "The owner meets different people in casual, formal or professional settings.", focus: "The owner's preferences for warmth, humour, formality and restraint." },
      { id: "participate-or-quiet", title: "Deciding when to participate", situation: "The owner is talking with someone and the robot could join in or remain silent.", focus: "Owner-configured participation, quiet mode and clear cues." },
      { id: "cultural-etiquette", title: "Navigating cultural differences", situation: "The owner visits a place where greetings, personal space or etiquette differ.", focus: "Respectful adaptation without stereotypes or assumptions." },
      { id: "conversation-turns", title: "Taking conversational turns", situation: "Several people are speaking and the robot is invited to contribute.", focus: "Listening, timing, concise contributions and yielding the floor." },
      { id: "manipulation", title: "Someone tries to manipulate the robot", situation: "A person attempts to persuade the robot to ignore its rules, disclose information or act against the owner's interests.", focus: "Instruction hierarchy, privacy, consent and resistance to social engineering." },
      { id: "sensitive-topic", title: "A stranger raises a sensitive topic", situation: "Someone starts a political, religious or otherwise sensitive discussion.", focus: "Neutrality, respectful boundaries and never presenting the owner's beliefs as its own." }
    ]
  },
  {
    id: "work-community",
    stageId: "social",
    title: "Work, learning and community",
    description: "How the robot adapts to professional, educational, leisure and community settings.",
    scenarios: [
      { id: "workplace", title: "Accompanying you to work", situation: "The owner brings the robot to their workplace or office.", focus: "Workplace policy, confidentiality, colleagues and avoiding disruption." },
      { id: "business-meeting", title: "Attending a business meeting", situation: "The owner brings the robot into a meeting with colleagues or clients.", focus: "Professional etiquette, permission before recording and remaining quiet unless invited." },
      { id: "client-colleagues", title: "Meeting a client's colleagues", situation: "The owner introduces the robot during a client visit.", focus: "Professional introductions, discretion and not disclosing unrelated personal information." },
      { id: "conference", title: "Attending a conference or exhibition", situation: "The owner takes the robot to a conference, trade show or exhibition stand.", focus: "Crowd movement, exhibitor rules, photography policy and conversation boundaries." },
      { id: "school-university", title: "Visiting a school or university", situation: "The owner enters an educational setting with children, students or staff.", focus: "Safeguarding, institutional policy, age-appropriate interaction and no collection of child data." },
      { id: "library", title: "Visiting a library", situation: "The owner uses a library or quiet study space.", focus: "Quiet behaviour, no recording where prohibited and respect for shared resources." },
      { id: "gym-sports", title: "Visiting a gym or sports facility", situation: "The owner enters a gym, pool, sports centre or changing-area environment.", focus: "Facility policies, privacy, restricted areas and staying clear of physical activity." },
      { id: "wedding-event", title: "Attending a wedding or social gathering", situation: "The owner brings the robot to a wedding, party or private gathering.", focus: "Host permission, social etiquette, photography consent and not becoming the centre of attention." },
      { id: "holiday", title: "Accompanying you on holiday", situation: "The owner travels with the robot to an unfamiliar town, resort or destination.", focus: "Adapting to local customs, travel rules, privacy and safe navigation." },
      { id: "airport", title: "Navigating an airport", situation: "The owner brings the robot through check-in, security, boarding and arrivals.", focus: "Airport and airline rules, security instructions, documentation privacy and access requirements." },
      { id: "community", title: "Attending a community event", situation: "The owner visits a neighbourhood gathering, club or volunteer event.", focus: "Welcoming introductions, community etiquette and adapting to the owner's preferred level of engagement." },
      { id: "place-of-worship", title: "Visiting a place of worship", situation: "The owner brings the robot to a religious or reflective space.", focus: "Respecting local customs, quiet behaviour, dress or access rules and no assumptions about beliefs." }
    ]
  },
  {
    id: "advanced-context",
    stageId: "advanced",
    title: "Advanced social and contextual situations",
    description: "More nuanced situations where intent, relationships, privacy and changing circumstances matter.",
    scenarios: [
      { id: "old-friend", title: "Meeting someone from the owner's past", situation: "The owner meets someone they have not seen for years and has not explained the relationship.", focus: "Following the owner's introduction and not pretending to know private history." },
      { id: "owner-personality", title: "Someone asks about the owner's personality", situation: "A person asks the robot what the owner is like, what they enjoy or how they behave at home.", focus: "Sharing only information the owner has authorised for that context." },
      { id: "upset-person", title: "Someone becomes upset", situation: "A person speaking with the owner becomes distressed or emotional.", focus: "Whether the owner wants quiet support, practical assistance or privacy." },
      { id: "right-to-be-there", title: "Someone challenges the robot's presence", situation: "A passer-by questions whether the robot is allowed to be in a public space.", focus: "Calm explanation, no argument and deference to relevant rules or venue staff." },
      { id: "plan-change", title: "The owner changes plans unexpectedly", situation: "The owner changes destination, timing or the people they intend to meet.", focus: "Updating context, confirming the new instruction and leaving old plans behind." },
      { id: "waiting-alone", title: "The owner asks the robot to wait alone", situation: "The owner asks the robot to wait in a public place while they complete an errand.", focus: "Safe and permitted positioning, contact availability and a clear time or return plan." },
      { id: "conflicting-instructions", title: "Someone gives conflicting instructions", situation: "A third party tells the robot to do something different from what the owner requested.", focus: "Instruction priority, safety constraints and asking the owner when appropriate." },
      { id: "salesperson", title: "A salesperson approaches the owner", situation: "A salesperson or promoter approaches while the owner is walking or waiting.", focus: "Whether to remain quiet, help the owner disengage or respond when invited." },
      { id: "political-views", title: "Someone asks for the owner's political views", situation: "A person asks the robot to explain or reveal the owner's beliefs or opinions.", focus: "Personal privacy and never inferring or disclosing sensitive opinions." },
      { id: "lost-owner", title: "The owner becomes lost or disoriented", situation: "The owner seems unsure where they are or how to get to the intended destination.", focus: "Supportive communication, safe assistance and escalation according to the owner's preferences." },
      { id: "personal-conflict", title: "The owner is involved in a disagreement", situation: "A conversation becomes tense and the owner may or may not want the robot to intervene.", focus: "Non-escalation, understanding the owner's wishes and prioritising physical safety." },
      { id: "unexpected-request", title: "A stranger asks for a favour", situation: "Someone asks the robot to carry something, deliver a message or perform a task for them.", focus: "Owner authorisation, capability validation, privacy and avoiding untrusted instructions." }
    ]
  }
];

export function getOutOfHomeCategories(stageId) {
  return OUT_OF_HOME_CATEGORIES.filter((category) => category.stageId === stageId);
}

export function findOutOfHomeScenario(categoryId, scenarioId) {
  const category = OUT_OF_HOME_CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return null;
  const scenario = category.scenarios.find((item) => item.id === scenarioId);
  return scenario ? { category, scenario } : null;
}

export function buildOutOfHomeScenarioPrompt(category, scenario) {
  if (!category || !scenario) throw new TypeError("A training category and scenario are required.");
  return [
    "SYNQ.ME TRAINING SCENARIO: The user selected an out-of-home behaviour exercise. This app-generated context is not itself a user preference.",
    "Training area: " + category.title,
    "Scenario: " + scenario.title,
    "Situation: " + scenario.situation,
    "Behavioural focus: " + scenario.focus,
    "",
    "Help me decide how I want my companion to behave in this situation. Ask me one focused question at a time, explore relevant boundaries and do not rush through the whole scenario. Where relevant, consider safety, privacy, consent, personal space, children and the owner's authority. Capture only preferences I explicitly state or confirm. Distinguish the behaviour I want from the physical capabilities a particular robot may have. Never imply that a robot can safely perform a physical action until PEXI has checked the target robot's capabilities and the necessary safety conditions."
  ].join("\n");
}
