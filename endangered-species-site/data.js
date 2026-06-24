/*
 * data.js — Endangered species dataset
 * Population figures are approximate, drawn from IUCN Red List–style estimates.
 * Family-tree dates are approximate divergence times in millions of years ago (mya).
 * This is an educational dataset, not a scientific citation source.
 */

const ANIMALS = [
  {
    id: "amur-leopard",
    name: "Amur Leopard",
    sci: "Panthera pardus orientalis",
    emoji: "🐆",
    status: "Critically Endangered",
    population: 100,
    region: "Russian Far East & NE China",
    role: "predator",
    roleNote: "Apex predator — hunts deer, hares and wild boar. Has no natural predators as an adult.",
    tree: [
      { clade: "Carnivora", when: "~55 mya", note: "Order of meat-eating mammals appears." },
      { clade: "Felidae", when: "~25 mya", note: "The cat family splits from other carnivorans." },
      { clade: "Pantherinae", when: "~11 mya", note: "Big-cat lineage (roaring cats) branches off." },
      { clade: "Panthera (genus)", when: "~6 mya", note: "Lions, tigers, leopards, jaguars share this ancestor." },
      { clade: "Leopard (P. pardus)", when: "~0.8 mya", note: "Leopards diverge as a species in Africa/Asia." },
      { clade: "Amur subspecies", when: "~0.01 mya", note: "Cold-adapted northern population isolates." }
    ]
  },
  {
    id: "vaquita",
    name: "Vaquita",
    sci: "Phocoena sinus",
    emoji: "🐬",
    status: "Critically Endangered",
    population: 10,
    region: "Northern Gulf of California",
    role: "predator",
    roleNote: "Predator of small fish, squid and crustaceans; the most endangered marine mammal on Earth.",
    tree: [
      { clade: "Artiodactyla", when: "~55 mya", note: "Even-toed ungulates — surprisingly, whales' ancestors." },
      { clade: "Cetacea", when: "~50 mya", note: "Land mammals return to the sea." },
      { clade: "Odontoceti", when: "~34 mya", note: "Toothed whales split from baleen whales." },
      { clade: "Phocoenidae", when: "~10 mya", note: "The porpoise family emerges." },
      { clade: "Vaquita (P. sinus)", when: "~2.5 mya", note: "Isolated in the Gulf of California." }
    ]
  },
  {
    id: "javan-rhino",
    name: "Javan Rhinoceros",
    sci: "Rhinoceros sondaicus",
    emoji: "🦏",
    status: "Critically Endangered",
    population: 76,
    region: "Ujung Kulon, Java",
    role: "prey",
    roleNote: "Megaherbivore. Adults are too large for most predators, but calves are vulnerable to dholes and big cats.",
    tree: [
      { clade: "Perissodactyla", when: "~56 mya", note: "Odd-toed ungulates (horses, tapirs, rhinos)." },
      { clade: "Rhinocerotidae", when: "~40 mya", note: "The rhinoceros family appears." },
      { clade: "Rhinoceros (genus)", when: "~15 mya", note: "Asian one-horned rhinos branch off." },
      { clade: "Javan rhino", when: "~2 mya", note: "Diverges from the Indian rhino lineage." }
    ]
  },
  {
    id: "sumatran-orangutan",
    name: "Sumatran Orangutan",
    sci: "Pongo abelii",
    emoji: "🦧",
    status: "Critically Endangered",
    population: 13800,
    region: "Sumatra, Indonesia",
    role: "prey",
    roleNote: "Frugivorous great ape. Occasionally preyed on by tigers; mostly threatened by habitat loss.",
    tree: [
      { clade: "Primates", when: "~65 mya", note: "Primate order arises near the dinosaurs' end." },
      { clade: "Hominidae", when: "~20 mya", note: "The great-ape family forms." },
      { clade: "Pongo (orangutans)", when: "~14 mya", note: "Asian apes split from African apes." },
      { clade: "Sumatran species", when: "~3.4 mya", note: "Sumatran and Bornean orangutans separate." }
    ]
  },
  {
    id: "mountain-gorilla",
    name: "Mountain Gorilla",
    sci: "Gorilla beringei beringei",
    emoji: "🦍",
    status: "Endangered",
    population: 1063,
    region: "Virunga Mountains & Bwindi",
    role: "prey",
    roleNote: "Herbivore. Adults have virtually no natural predators; a rare conservation success, slowly increasing.",
    tree: [
      { clade: "Primates", when: "~65 mya", note: "Primate order arises." },
      { clade: "Hominidae", when: "~20 mya", note: "Great-ape family forms." },
      { clade: "Gorilla (genus)", when: "~9 mya", note: "Gorillas split from the human/chimp line." },
      { clade: "Eastern gorilla", when: "~1 mya", note: "Eastern and western gorillas diverge." }
    ]
  },
  {
    id: "sumatran-tiger",
    name: "Sumatran Tiger",
    sci: "Panthera tigris sumatrae",
    emoji: "🐅",
    status: "Critically Endangered",
    population: 400,
    region: "Sumatra, Indonesia",
    role: "predator",
    roleNote: "Apex predator of its rainforest; the smallest surviving tiger subspecies.",
    tree: [
      { clade: "Felidae", when: "~25 mya", note: "The cat family appears." },
      { clade: "Pantherinae", when: "~11 mya", note: "Roaring-cat lineage." },
      { clade: "Panthera (genus)", when: "~6 mya", note: "Big-cat genus ancestor." },
      { clade: "Tiger (P. tigris)", when: "~3 mya", note: "Tigers diverge in Asia." },
      { clade: "Sumatran subspecies", when: "~0.07 mya", note: "Isolated when Sumatra separated from the mainland." }
    ]
  },
  {
    id: "axolotl",
    name: "Axolotl",
    sci: "Ambystoma mexicanum",
    emoji: "🦎",
    status: "Critically Endangered",
    population: 1000,
    region: "Lake Xochimilco, Mexico",
    role: "predator",
    roleNote: "Neotenic salamander; predator of worms, insects and small fish. Famous for regenerating limbs.",
    tree: [
      { clade: "Tetrapoda", when: "~390 mya", note: "Four-limbed vertebrates leave the water." },
      { clade: "Amphibia", when: "~340 mya", note: "Amphibian lineage establishes." },
      { clade: "Caudata (salamanders)", when: "~160 mya", note: "Tailed amphibians diverge." },
      { clade: "Ambystoma (genus)", when: "~30 mya", note: "Mole salamanders appear." },
      { clade: "Axolotl", when: "~1.5 mya", note: "Adapts to permanent lake life, never metamorphosing." }
    ]
  },
  {
    id: "sunda-pangolin",
    name: "Sunda Pangolin",
    sci: "Manis javanica",
    emoji: "🦔",
    status: "Critically Endangered",
    population: 50000,
    region: "Southeast Asia",
    role: "predator",
    roleNote: "Insectivore — eats ants and termites. The world's most trafficked mammal.",
    tree: [
      { clade: "Laurasiatheria", when: "~80 mya", note: "Major placental-mammal group." },
      { clade: "Pholidota", when: "~60 mya", note: "Pangolins split from carnivorans." },
      { clade: "Manidae", when: "~40 mya", note: "The pangolin family forms." },
      { clade: "Sunda pangolin", when: "~5 mya", note: "Southeast-Asian species diverges." }
    ]
  },
  {
    id: "african-forest-elephant",
    name: "African Forest Elephant",
    sci: "Loxodonta cyclotis",
    emoji: "🐘",
    status: "Critically Endangered",
    population: 150000,
    region: "Congo Basin rainforests",
    role: "prey",
    roleNote: "Megaherbivore and 'gardener of the forest'. Calves can fall to lions/leopards; adults are nearly untouchable.",
    tree: [
      { clade: "Afrotheria", when: "~90 mya", note: "African mammal superorder." },
      { clade: "Proboscidea", when: "~60 mya", note: "Trunked mammals appear." },
      { clade: "Elephantidae", when: "~7 mya", note: "Modern elephant family forms." },
      { clade: "Loxodonta", when: "~5 mya", note: "African elephants split from Asian." },
      { clade: "Forest elephant", when: "~2.6 mya", note: "Splits from the African savanna elephant." }
    ]
  },
  {
    id: "saola",
    name: "Saola",
    sci: "Pseudoryx nghetinhensis",
    emoji: "🦌",
    status: "Critically Endangered",
    population: 100,
    region: "Annamite Range, Vietnam/Laos",
    role: "prey",
    roleNote: "Forest-dwelling bovine, the 'Asian unicorn'. So rare it has never been seen by a scientist in the wild for long.",
    tree: [
      { clade: "Artiodactyla", when: "~55 mya", note: "Even-toed ungulates." },
      { clade: "Bovidae", when: "~20 mya", note: "Cattle, antelope and relatives." },
      { clade: "Pseudoryx (genus)", when: "~8 mya", note: "An ancient, isolated bovine lineage." },
      { clade: "Saola", when: "~unknown", note: "Discovered only in 1992 — one of the last large mammals found." }
    ]
  }
];

// Plants are described by IUCN status + a note. (Round 1: removed the unused
// and self-contradictory `population` field flagged by Mistral & Cohere.)
const PLANTS = [
  {
    id: "woods-cycad",
    name: "Wood's Cycad",
    sci: "Encephalartos woodii",
    emoji: "🌴",
    status: "Extinct in the Wild",
    note: "Only clones of a single male plant survive — no female has ever been found, so it cannot reproduce naturally."
  },
  {
    id: "underground-orchid",
    name: "Western Underground Orchid",
    sci: "Rhizanthella gardneri",
    emoji: "🌸",
    status: "Critically Endangered",
    note: "Lives and flowers entirely underground, relying on a fungus and a shrub to survive."
  },
  {
    id: "pennantia",
    name: "Three Kings Kaikōmako",
    sci: "Pennantia baylisiana",
    emoji: "🌿",
    status: "Critically Endangered",
    note: "Once a single wild tree on a New Zealand island — called the world's loneliest tree."
  },
  {
    id: "dragons-blood",
    name: "Dragon's Blood Tree",
    sci: "Dracaena cinnabari",
    emoji: "🌳",
    status: "Vulnerable",
    note: "Umbrella-shaped Socotran tree that bleeds red sap; failing to regenerate as its island dries out."
  },
  {
    id: "venus-flytrap",
    name: "Venus Flytrap",
    sci: "Dionaea muscipula",
    emoji: "🪤",
    status: "Vulnerable",
    note: "Carnivorous plant native to a tiny patch of the Carolinas; threatened by poaching and habitat loss."
  },
  {
    id: "jellyfish-tree",
    name: "Jellyfish Tree",
    sci: "Medusagyne oppositifolia",
    emoji: "🪸",
    status: "Critically Endangered",
    note: "A Seychelles relict thought extinct until rediscovered; its fruit splits open like a jellyfish."
  }
];

// Facts Jimmy cycles through when clicked.
const JIMMY_FACTS = [
  "Hi, I'm Jimmy! 📎 Click any animal in the dropdown to trace its family tree.",
  "The vaquita is down to about 10 individuals — the rarest marine mammal alive.",
  "Mountain gorillas are one of the few endangered species that are actually increasing!",
  "Wood's Cycad is 'extinct in the wild' — every surviving plant is a clone of one male.",
  "Tigers and leopards both belong to the genus Panthera, sharing an ancestor ~6 million years ago.",
  "The axolotl never grows up — it keeps its larval form for life. Looks like me, kind of.",
  "Pangolins are the most trafficked mammals on Earth. Be their friend, not a buyer.",
  "Predators keep ecosystems balanced — losing one can collapse a whole food web."
];

if (typeof module !== "undefined") {
  module.exports = { ANIMALS, PLANTS, JIMMY_FACTS };
}
