export const ROOM_JOURNEY_ROOMS = [
  {
    id: "kitchen",
    name: "Kitchen",
    label: "Kitchen",
    icon: "K",
    summary: "Build a clear picture of how you like your kitchen organised, cleaned and used.",
    tasks: [
      { id: "dishwashing", week: 1, title: "Dishwashing preferences", description: "How you like dishes loaded, washed and put away.", prompt: "Let's work on my kitchen. Ask me about my dishwashing preferences.", keywords: ["dishwasher", "dishwashing", "dishes", "cutlery", "crockery", "washing-up"] },
      { id: "surfaces", week: 1, title: "Worktops and surfaces", description: "How you want worktops, counters and kitchen surfaces treated.", prompt: "Let's work on my kitchen worktops and surfaces. Help me explain how I like them cleaned.", keywords: ["kitchen worktop", "worktop", "countertop", "kitchen counter", "kitchen surface"] },
      { id: "products", week: 2, title: "Approved cleaning products", description: "Which products are suitable and which should be avoided.", prompt: "Let's record which cleaning products I approve for the kitchen.", keywords: ["cleaning product", "surface cleaner", "dish soap", "washing-up liquid", "paper towels", "kitchen detergent"] },
      { id: "food-prep", week: 3, title: "Food and preparation routines", description: "Your preferences around food preparation, ingredients and kitchen routines.", prompt: "Let's discuss my food preparation and kitchen routines.", keywords: ["meal prep", "meal preparation", "food preparation", "cooking", "ingredients", "recipe", "groceries"] },
      { id: "boundaries", week: 4, title: "Kitchen boundaries", description: "What must be left alone and when you want me to ask first.", prompt: "Let's set my kitchen boundaries, including what you should ask me before moving or handling.", keywords: ["ask me before", "ask before", "without asking", "without permission", "do not move", "don't move", "fragile items"] }
    ]
  },
  {
    id: "living_room",
    name: "Living Room",
    label: "Living room",
    icon: "L",
    summary: "Personalise how your shared living space is kept, used and respected.",
    tasks: [
      { id: "tidying", week: 1, title: "Tidying and object placement", description: "Where everyday items belong and what should stay where it is.", prompt: "Let's personalise my living room. Ask me how I like things kept tidy and where items belong.", keywords: ["living room", "sofa", "couch", "coffee table", "bookshelf", "remote control"] },
      { id: "surfaces", week: 1, title: "Furniture and surfaces", description: "Your preferences for tables, shelves, upholstery and delicate finishes.", prompt: "Let's discuss how I like my living room furniture and surfaces cared for.", keywords: ["living room surface", "coffee table", "shelves", "upholstery", "sofa fabric", "wooden furniture"] },
      { id: "entertainment", week: 2, title: "TV and entertainment", description: "How you use and organise screens, remotes and audio equipment.", prompt: "Let's record how I use and organise my television and entertainment equipment.", keywords: ["television", "TV", "remote", "sound system", "speaker", "entertainment"] },
      { id: "guests", week: 3, title: "Guests and shared space", description: "How you prefer the room prepared when people visit.", prompt: "Let's discuss how I like my living room prepared when I have guests.", keywords: ["guests", "visitors", "entertaining", "people visit", "hosting"] },
      { id: "boundaries", week: 4, title: "Personal items and boundaries", description: "What should not be handled, moved or reorganised without asking.", prompt: "Let's set my living room boundaries and the things you should ask me about first.", keywords: ["personal belongings", "private items", "ask me before", "leave it where", "do not move", "don't move"] }
    ]
  },
  {
    id: "bathroom",
    name: "Bathroom",
    label: "Bathroom",
    icon: "B",
    summary: "Capture your bathroom cleaning standards, preferred products and personal boundaries.",
    tasks: [
      { id: "cleaning", week: 1, title: "Cleaning priorities", description: "Your priorities for the sink, shower, bath, toilet and floors.", prompt: "Let's personalise my bathroom cleaning priorities.", keywords: ["bathroom", "shower", "bath", "toilet", "sink", "bathroom floor"] },
      { id: "towels", week: 1, title: "Towels and linen", description: "How towels, bath mats and bathroom linen should be handled.", prompt: "Let's record how I like bathroom towels and linen handled.", keywords: ["towel", "bath mat", "bathroom linen", "hand towel"] },
      { id: "toiletries", week: 2, title: "Toiletries and storage", description: "Where toiletries belong and how personal items should be arranged.", prompt: "Let's discuss where I keep toiletries and how I like bathroom storage arranged.", keywords: ["toiletries", "toothbrush", "shampoo", "bathroom storage", "cosmetics"] },
      { id: "products", week: 3, title: "Bathroom products and materials", description: "Which products are safe for the surfaces and finishes in your bathroom.", prompt: "Let's identify which cleaning products I approve for my bathroom surfaces.", keywords: ["bathroom cleaner", "limescale", "descaler", "tile cleaner", "bathroom product", "grout"] },
      { id: "privacy", week: 4, title: "Privacy and boundaries", description: "Personal items, privacy expectations and when to ask before entering or handling things.", prompt: "Let's set my bathroom privacy expectations and boundaries.", keywords: ["bathroom privacy", "private bathroom", "ask before entering", "personal toiletries", "personal items"] }
    ]
  },
  {
    id: "bedroom",
    name: "Bedroom",
    label: "Bedroom",
    icon: "D",
    summary: "Teach your SecondSelf how you like your private space, belongings and routines respected.",
    tasks: [
      { id: "bed-linen", week: 1, title: "Bed and linen", description: "How you like the bed made and sheets or bedding changed.", prompt: "Let's personalise how I like my bed made and bedroom linen handled.", keywords: ["bed linen", "bedsheets", "bed sheets", "bedding", "make the bed", "duvet"] },
      { id: "clothing", week: 1, title: "Clothing and wardrobe", description: "How clothes should be sorted, folded, hung and put away.", prompt: "Let's record how I like my clothes and wardrobe organised.", keywords: ["wardrobe", "clothing", "clothes", "hanging clothes", "fold clothes", "drawers"] },
      { id: "belongings", week: 2, title: "Personal belongings", description: "Where personal items belong and what must not be moved.", prompt: "Let's discuss how I want my personal belongings treated in the bedroom.", keywords: ["bedside", "personal belongings", "bedroom items", "jewellery", "valuables"] },
      { id: "routine", week: 3, title: "Bedroom routine", description: "When you prefer tidying, changing linen and other bedroom tasks.", prompt: "Let's discuss my preferred bedroom routines and timing.", keywords: ["bedroom routine", "bedroom schedule", "bedroom cleaning", "change the sheets", "change bedding"] },
      { id: "privacy", week: 4, title: "Privacy and access", description: "Your rules for privacy, access and asking before handling items.", prompt: "Let's set my bedroom privacy rules and access boundaries.", keywords: ["bedroom privacy", "private space", "ask before entering", "bedroom boundary"] }
    ]
  },
  {
    id: "laundry_utility",
    name: "Laundry & Utility",
    label: "Laundry & utility",
    icon: "U",
    summary: "Create a reliable understanding of how you like clothes and laundry handled.",
    tasks: [
      { id: "sorting", week: 1, title: "Sorting laundry", description: "How you separate colours, fabrics and different types of clothing.", prompt: "Let's record how I like laundry sorted before washing.", keywords: ["laundry sorting", "sort laundry", "separate clothes", "separate colours", "dark clothes", "light clothes"] },
      { id: "washing", week: 1, title: "Washing and drying", description: "Preferred temperatures, cycles, detergents and drying methods.", prompt: "Let's discuss my preferred washing and drying settings.", keywords: ["washing machine", "wash temperature", "washing cycle", "drying clothes", "tumble dryer", "laundry detergent"] },
      { id: "delicates", week: 2, title: "Delicates and special care", description: "Items that need a special cycle, hand washing or air drying.", prompt: "Let's identify clothes and fabrics that need special laundry care.", keywords: ["delicates", "wool", "silk", "hand wash", "air dry", "fabric care"] },
      { id: "put-away", week: 3, title: "Folding and putting away", description: "How clean clothes should be folded, hung and stored.", prompt: "Let's record how I like clean clothes folded, hung and put away.", keywords: ["folding", "fold clothes", "put clothes away", "hang clothes", "laundry storage"] },
      { id: "schedule", week: 4, title: "Laundry routine", description: "Your preferred laundry days, timing and order of tasks.", prompt: "Let's define my preferred laundry schedule and routine.", keywords: ["laundry day", "laundry schedule", "laundry routine", "wash day"] }
    ]
  },
  {
    id: "garage_storage",
    name: "Garage & Storage",
    label: "Garage & storage",
    icon: "G",
    summary: "Map how you organise stored items, tools and access to practical spaces.",
    tasks: [
      { id: "storage-map", week: 1, title: "Storage locations", description: "Where boxes, equipment and seasonal items are kept.", prompt: "Let's map how I organise my garage and storage areas.", keywords: ["garage storage", "storage box", "storage area", "shelving", "seasonal items"] },
      { id: "tools", week: 1, title: "Tools and equipment", description: "Where tools belong and how you want them handled.", prompt: "Let's record where I keep tools and how I want them organised.", keywords: ["tools", "toolbox", "drill", "equipment", "workbench"] },
      { id: "vehicle", week: 2, title: "Vehicle and access space", description: "Clear areas, vehicle access and items that must not obstruct them.", prompt: "Let's discuss the garage space I need kept clear for vehicle access.", keywords: ["car space", "vehicle access", "parking space", "garage door"] },
      { id: "safety", week: 3, title: "Safety and restricted items", description: "Heavy, sharp, hazardous or restricted items that need special handling.", prompt: "Let's record my garage safety rules and items that need special handling.", keywords: ["garage safety", "sharp tools", "heavy equipment", "hazardous", "restricted access"] },
      { id: "boundaries", week: 4, title: "Storage boundaries", description: "What must not be discarded, moved or reorganised without asking.", prompt: "Let's set rules for what must not be moved or thrown away in my garage.", keywords: ["throw away", "discard", "do not move", "don't move", "ask before moving", "stored belongings"] }
    ]
  },
  {
    id: "dining_room",
    name: "Dining Room",
    label: "Dining room",
    icon: "T",
    summary: "Personalise table settings, dining routines and care for special items.",
    tasks: [
      { id: "table", week: 1, title: "Table and place settings", description: "How you like the dining table arranged and prepared.", prompt: "Let's personalise how I like the dining table set and prepared.", keywords: ["dining table", "place setting", "table setting", "placemat", "tablecloth"] },
      { id: "crockery", week: 1, title: "Crockery and glassware", description: "How plates, glasses and special pieces should be stored and handled.", prompt: "Let's record my preferences for dining crockery and glassware.", keywords: ["glassware", "wine glasses", "dining crockery", "plates", "china"] },
      { id: "meals", week: 2, title: "Dining routines", description: "How you prefer meals and the dining area organised.", prompt: "Let's discuss my dining room routines around meals.", keywords: ["dining routine", "meal time", "dining area", "serving meals"] },
      { id: "guests", week: 3, title: "Guests and occasions", description: "How you prepare the room for guests and special occasions.", prompt: "Let's discuss how I like the dining room prepared for guests.", keywords: ["dinner guests", "dinner party", "special occasion", "hosting"] },
      { id: "care", week: 4, title: "Care and boundaries", description: "Furniture care, special items and what should be left untouched.", prompt: "Let's set my dining room care preferences and boundaries.", keywords: ["dining furniture", "dining table care", "special china", "fragile glassware"] }
    ]
  },
  {
    id: "hallway_entry",
    name: "Hallway & Entrance",
    label: "Hallway & entrance",
    icon: "H",
    summary: "Set your preferences for shoes, coats, keys and keeping entrance areas clear.",
    tasks: [
      { id: "shoes", week: 1, title: "Shoes and footwear", description: "Where shoes belong and how you like them organised.", prompt: "Let's record where I like shoes and footwear kept.", keywords: ["shoes", "footwear", "shoe rack", "boots"] },
      { id: "coats", week: 1, title: "Coats and bags", description: "Where coats, bags and everyday items should be placed.", prompt: "Let's organise my preferences for coats, bags and hallway storage.", keywords: ["coat", "coat hooks", "bags", "handbags", "hallway storage"] },
      { id: "keys", week: 2, title: "Keys and essentials", description: "Where everyday essentials are kept so they remain easy to find.", prompt: "Let's record where I keep keys and everyday essentials.", keywords: ["keys", "key bowl", "wallet", "everyday essentials"] },
      { id: "floors", week: 3, title: "Entrance and floors", description: "How you like entrance floors and high-traffic areas kept clean.", prompt: "Let's discuss how I like the entrance and hallway floors maintained.", keywords: ["hallway floor", "entrance floor", "doormat", "entryway cleaning"] },
      { id: "access", week: 4, title: "Access and boundaries", description: "Your rules around doors, deliveries and items near the entrance.", prompt: "Let's set my entrance access and privacy preferences.", keywords: ["front door", "deliveries", "door access", "entryway boundary"] }
    ]
  },
  {
    id: "home_office",
    name: "Home Office",
    label: "Home office",
    icon: "O",
    summary: "Capture how you like your workspace, equipment and private documents treated.",
    tasks: [
      { id: "desk", week: 1, title: "Desk organisation", description: "How you like your desk and work surfaces arranged.", prompt: "Let's personalise how I like my home office desk organised.", keywords: ["desk", "workspace", "home office", "office surface"] },
      { id: "equipment", week: 1, title: "Devices and equipment", description: "How computers, screens, cables and accessories should be handled.", prompt: "Let's record how I want my office equipment handled.", keywords: ["computer", "monitor", "keyboard", "cables", "office equipment"] },
      { id: "documents", week: 2, title: "Documents and privacy", description: "How papers and private or confidential materials should be handled.", prompt: "Let's set my preferences for documents and privacy in the home office.", keywords: ["documents", "paperwork", "confidential", "private papers", "work files"] },
      { id: "routine", week: 3, title: "Workspace routine", description: "When you like your office tidied and what helps you concentrate.", prompt: "Let's discuss my preferred home office routine and timing.", keywords: ["office routine", "work schedule", "workspace routine", "concentration"] },
      { id: "boundaries", week: 4, title: "Workspace boundaries", description: "What should not be moved, opened or changed without permission.", prompt: "Let's record what should be left alone in my home office.", keywords: ["office privacy", "do not open", "don't open", "do not move", "ask before handling"] }
    ]
  },
  {
    id: "garden_outdoor",
    name: "Garden & Outdoor",
    label: "Garden & outdoor",
    icon: "A",
    summary: "Teach your SecondSelf about outdoor spaces, plants and garden routines.",
    tasks: [
      { id: "plants", week: 1, title: "Plants and watering", description: "Plant care, watering preferences and special requirements.", prompt: "Let's record how I like my plants and garden cared for.", keywords: ["plants", "watering", "water plants", "garden plants", "plant care"] },
      { id: "outdoor", week: 1, title: "Outdoor furniture", description: "How outdoor seating and furniture should be arranged and cared for.", prompt: "Let's discuss my outdoor furniture and patio preferences.", keywords: ["outdoor furniture", "garden furniture", "patio furniture", "garden table"] },
      { id: "cleaning", week: 2, title: "Outdoor cleaning", description: "How you prefer paths, patios and outdoor surfaces maintained.", prompt: "Let's discuss how I like outdoor areas and paths kept clean.", keywords: ["patio cleaning", "garden path", "outdoor cleaning", "terrace cleaning"] },
      { id: "seasonal", week: 3, title: "Seasonal routines", description: "Seasonal tasks and how weather changes your preferences.", prompt: "Let's record my seasonal garden and outdoor routines.", keywords: ["seasonal garden", "seasonal routine", "weather", "outdoor schedule"] },
      { id: "boundaries", week: 4, title: "Outdoor boundaries", description: "Areas, tools and plants that need special care or should be left alone.", prompt: "Let's set my outdoor area boundaries and special care rules.", keywords: ["garden boundary", "special plants", "garden tools", "leave the garden", "outdoor privacy"] }
    ]
  },
  {
    id: "guest_room",
    name: "Guest Room",
    label: "Guest room",
    icon: "R",
    summary: "Set your preferences for preparing guest spaces while respecting privacy and belongings.",
    tasks: [
      { id: "bedding", week: 1, title: "Guest bedding", description: "How you prepare beds, linen and towels for visitors.", prompt: "Let's record how I like the guest bed and linen prepared.", keywords: ["guest bed", "guest bedding", "guest linen", "guest towels"] },
      { id: "storage", week: 1, title: "Guest storage", description: "Where guest belongings can be placed and what space should stay clear.", prompt: "Let's discuss storage and space in my guest room.", keywords: ["guest storage", "guest wardrobe", "guest room storage", "guest belongings"] },
      { id: "comfort", week: 2, title: "Guest comfort", description: "The small details that make the room comfortable for visitors.", prompt: "Let's discuss what makes my guest room comfortable for visitors.", keywords: ["guest comfort", "guest room", "visitors", "guest amenities"] },
      { id: "routine", week: 3, title: "Between-visit routine", description: "How you prefer the room maintained when it is not in use.", prompt: "Let's define my guest room routine between visits.", keywords: ["between visits", "guest room routine", "guest room cleaning"] },
      { id: "privacy", week: 4, title: "Privacy and belongings", description: "Personal items and guest belongings that should not be moved or opened.", prompt: "Let's set my guest room privacy and belongings rules.", keywords: ["guest privacy", "guest belongings", "private items", "do not open", "don't open"] }
    ]
  },
  {
    id: "balcony_patio",
    name: "Balcony & Patio",
    label: "Balcony & patio",
    icon: "P",
    summary: "Finish your first home journey by personalising smaller outdoor living spaces.",
    tasks: [
      { id: "furniture", week: 1, title: "Furniture and layout", description: "How you like outdoor seating and furniture arranged.", prompt: "Let's personalise the layout and furniture on my balcony or patio.", keywords: ["balcony furniture", "patio furniture", "outdoor seating", "balcony layout"] },
      { id: "plants", week: 1, title: "Pots and plants", description: "How containers, plants and watering should be handled.", prompt: "Let's discuss my balcony plants, pots and watering preferences.", keywords: ["balcony plants", "patio plants", "plant pots", "balcony watering"] },
      { id: "cleaning", week: 2, title: "Cleaning and maintenance", description: "Your preferences for floors, glass, railings and outdoor surfaces.", prompt: "Let's record how I like my balcony or patio cleaned.", keywords: ["balcony cleaning", "patio cleaning", "balcony floor", "railings"] },
      { id: "weather", week: 3, title: "Weather and protection", description: "When furniture, cushions and plants need to be protected.", prompt: "Let's discuss how I want my balcony or patio prepared for different weather.", keywords: ["outdoor cushions", "weather protection", "wind", "rain protection", "sun protection"] },
      { id: "boundaries", week: 4, title: "Access and boundaries", description: "Items that need special care and any limits on access or movement.", prompt: "Let's set my balcony and patio access and care boundaries.", keywords: ["balcony access", "patio boundary", "outdoor belongings", "ask before moving"] }
    ]
  }
];

export function addMonthsAnchored(dateValue, months) {
  const original = new Date(dateValue);
  if (!Number.isFinite(original.getTime())) throw new TypeError("A valid journey start date is required.");
  const day = original.getUTCDate();
  const targetMonth = original.getUTCMonth() + months;
  const targetStart = new Date(Date.UTC(
    original.getUTCFullYear(),
    targetMonth,
    1,
    original.getUTCHours(),
    original.getUTCMinutes(),
    original.getUTCSeconds(),
    original.getUTCMilliseconds()
  ));
  const lastDay = new Date(Date.UTC(targetStart.getUTCFullYear(), targetStart.getUTCMonth() + 1, 0)).getUTCDate();
  targetStart.setUTCDate(Math.min(day, lastDay));
  return targetStart;
}

export function getRoomJourneySchedule(startedAt, nowValue = new Date()) {
  const start = new Date(startedAt);
  const now = new Date(nowValue);
  if (!Number.isFinite(start.getTime())) throw new TypeError("A valid journey start date is required.");
  if (!Number.isFinite(now.getTime())) throw new TypeError("A valid current date is required.");

  let unlockedCount = 0;
  for (let index = 0; index < ROOM_JOURNEY_ROOMS.length; index += 1) {
    if (now >= addMonthsAnchored(start, index)) unlockedCount += 1;
    else break;
  }

  const nextUnlockAt = unlockedCount < ROOM_JOURNEY_ROOMS.length
    ? addMonthsAnchored(start, unlockedCount)
    : null;

  return {
    unlockedRooms: ROOM_JOURNEY_ROOMS.slice(0, unlockedCount),
    unlockedCount,
    nextUnlockAt,
    completedReleaseSchedule: unlockedCount === ROOM_JOURNEY_ROOMS.length
  };
}

export function deriveCompletedRoomTasks(room, evidenceRecords = []) {
  if (!room || !Array.isArray(room.tasks)) return [];
  const records = evidenceRecords
    .filter((item) => item && ["user_stated", "user_confirmed"].includes(String(item.status || "user_stated")))
    .map((item) => String(item.text || item.statement || "").toLowerCase())
    .filter(Boolean);

  return room.tasks
    .filter((task) => task.keywords.some((keyword) => records.some((text) => text.includes(keyword.toLowerCase()))))
    .map((task) => task.id);
}

export function buildRoomProgressSnapshot(rooms = ROOM_JOURNEY_ROOMS, evidenceRecords = []) {
  return Object.fromEntries(rooms.map((room) => [
    room.id,
    { completed_task_ids: deriveCompletedRoomTasks(room, evidenceRecords) }
  ]));
}
