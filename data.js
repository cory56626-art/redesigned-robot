/* data.js — endangered animal dataset
 * Populations are best-available published estimates with an "asOf" year.
 * Trees are simplified for readability, not exhaustive cladograms.
 */
window.ANIMALS = [
  {
    id: "amur-leopard",
    name: "Amur Leopard",
    sci: "Panthera pardus orientalis",
    emoji: "🐆",
    status: "Critically Endangered",
    population: 130,
    asOf: 2023,
    trend: "up",
    region: "Russian Far East & NE China",
    blurb:
      "The rarest big cat on Earth. Adapted to cold temperate forests, it can run up to 60 km/h and leap 3 m vertically.",
    family: {
      label: "Kingdom → Species (taxonomy)",
      nodes: [
        "Animalia (Kingdom)",
        "Chordata (Phylum)",
        "Mammalia (Class)",
        "Carnivora (Order)",
        "Felidae (Family)",
        "Panthera (Genus)",
        "P. pardus (Species)",
        "P. p. orientalis (Subspecies)"
      ]
    },
    evolution: {
      label: "Evolutionary lineage",
      nodes: [
        "Miacids (~60 Mya)",
        "Early Feliformia (~50 Mya)",
        "Pseudaelurus (~20 Mya)",
        "Panthera lineage (~11 Mya)",
        "Leopard split (~3 Mya)",
        "Amur subspecies (last Ice Age refugia)"
      ]
    },
    roles: [
      { era: "Pleistocene", role: "predator", note: "Apex ambush hunter of deer and boar; competed with cave lions and tigers." },
      { era: "Holocene", role: "predator", note: "Top predator of roe/sika deer in temperate forest." },
      { era: "Modern (industrial era)", role: "prey", note: "Hunted by humans for fur and from poaching; habitat collapse made it prey to human pressure." }
    ]
  },
  {
    id: "vaquita",
    name: "Vaquita",
    sci: "Phocoena sinus",
    emoji: "🐬",
    status: "Critically Endangered",
    population: 10,
    asOf: 2023,
    trend: "down",
    region: "Northern Gulf of California, Mexico",
    blurb:
      "The world's smallest and most endangered cetacean. Killed almost entirely as bycatch in illegal gillnets.",
    family: {
      label: "Kingdom → Species (taxonomy)",
      nodes: [
        "Animalia (Kingdom)",
        "Chordata (Phylum)",
        "Mammalia (Class)",
        "Artiodactyla (Order)",
        "Phocoenidae (Family)",
        "Phocoena (Genus)",
        "P. sinus (Species)"
      ]
    },
    evolution: {
      label: "Evolutionary lineage",
      nodes: [
        "Early artiodactyls (~55 Mya)",
        "Pakicetus, land-to-sea (~50 Mya)",
        "Basilosaurus (~38 Mya)",
        "Odontoceti / toothed whales (~34 Mya)",
        "Porpoises split (~15 Mya)",
        "Vaquita (Gulf endemic)"
      ]
    },
    roles: [
      { era: "Miocene oceans", role: "predator", note: "Porpoise ancestors hunted small fish and squid." },
      { era: "Holocene", role: "predator", note: "Feeds on fish, squid and crustaceans in shallow lagoons." },
      { era: "Modern", role: "prey", note: "Not hunted directly, but caught and drowned as bycatch — effectively prey to fishing gear." }
    ]
  },
  {
    id: "javan-rhino",
    name: "Javan Rhino",
    sci: "Rhinoceros sondaicus",
    emoji: "🦏",
    status: "Critically Endangered",
    population: 76,
    asOf: 2023,
    trend: "stable",
    region: "Ujung Kulon National Park, Java",
    blurb:
      "Once the most widespread Asian rhino, now confined to a single park. Males have a small single horn; many females have none.",
    family: {
      label: "Kingdom → Species (taxonomy)",
      nodes: [
        "Animalia (Kingdom)",
        "Chordata (Phylum)",
        "Mammalia (Class)",
        "Perissodactyla (Order)",
        "Rhinocerotidae (Family)",
        "Rhinoceros (Genus)",
        "R. sondaicus (Species)"
      ]
    },
    evolution: {
      label: "Evolutionary lineage",
      nodes: [
        "Early perissodactyls (~55 Mya)",
        "Hyracodontidae (~40 Mya)",
        "Paraceratherium (~30 Mya)",
        "True Rhinocerotidae (~25 Mya)",
        "Rhinoceros genus (~10 Mya)",
        "Javan rhino lineage"
      ]
    },
    roles: [
      { era: "Pleistocene", role: "prey", note: "Megaherbivore browsed by predation pressure from tigers and ancient humans." },
      { era: "Holocene", role: "prey", note: "Large grazer/browser; adults nearly invulnerable except to tigers and people." },
      { era: "Modern", role: "prey", note: "Devastated by horn poaching and habitat loss." }
    ]
  },
  {
    id: "mountain-gorilla",
    name: "Mountain Gorilla",
    sci: "Gorilla beringei beringei",
    emoji: "🦍",
    status: "Endangered",
    population: 1063,
    asOf: 2018,
    trend: "up",
    region: "Virunga Mountains & Bwindi (Central Africa)",
    blurb:
      "A conservation success story — numbers have climbed past 1,000 thanks to intensive protection and eco-tourism.",
    family: {
      label: "Kingdom → Species (taxonomy)",
      nodes: [
        "Animalia (Kingdom)",
        "Chordata (Phylum)",
        "Mammalia (Class)",
        "Primates (Order)",
        "Hominidae (Family)",
        "Gorilla (Genus)",
        "G. beringei (Species)",
        "G. b. beringei (Subspecies)"
      ]
    },
    evolution: {
      label: "Evolutionary lineage",
      nodes: [
        "Early primates (~55 Mya)",
        "Catarrhines (~30 Mya)",
        "Great-ape ancestor (~20 Mya)",
        "Gorilla/Human split (~9 Mya)",
        "Gorilla genus (~2 Mya)",
        "Mountain subspecies (~0.4 Mya)"
      ]
    },
    roles: [
      { era: "Miocene–Pliocene", role: "prey", note: "Large apes preyed on by big cats and crowned eagles (juveniles)." },
      { era: "Holocene", role: "prey", note: "Mainly herbivorous; leopards are the only natural predator." },
      { era: "Modern", role: "prey", note: "Threatened by poaching, snares, disease and habitat loss." }
    ]
  },
  {
    id: "sumatran-orangutan",
    name: "Sumatran Orangutan",
    sci: "Pongo abelii",
    emoji: "🦧",
    status: "Critically Endangered",
    population: 13846,
    asOf: 2016,
    trend: "down",
    region: "Northern Sumatra, Indonesia",
    blurb:
      "Highly intelligent, tool-using great ape. Almost entirely arboreal and devastated by palm-oil deforestation.",
    family: {
      label: "Kingdom → Species (taxonomy)",
      nodes: [
        "Animalia (Kingdom)",
        "Chordata (Phylum)",
        "Mammalia (Class)",
        "Primates (Order)",
        "Hominidae (Family)",
        "Pongo (Genus)",
        "P. abelii (Species)"
      ]
    },
    evolution: {
      label: "Evolutionary lineage",
      nodes: [
        "Early primates (~55 Mya)",
        "Catarrhines (~30 Mya)",
        "Great-ape ancestor (~20 Mya)",
        "Pongo lineage split (~14 Mya)",
        "Sivapithecus relatives (~12 Mya)",
        "Sumatran species (~0.7 Mya)"
      ]
    },
    roles: [
      { era: "Pleistocene", role: "prey", note: "Hunted by tigers and clouded leopards; Sumatran tigers still take some." },
      { era: "Holocene", role: "prey", note: "Frugivorous; vulnerable when descending to the ground." },
      { era: "Modern", role: "prey", note: "Killed in conflict and orphaned by logging and fires." }
    ]
  },
  {
    id: "hawksbill-turtle",
    name: "Hawksbill Sea Turtle",
    sci: "Eretmochelys imbricata",
    emoji: "🐢",
    status: "Critically Endangered",
    population: 23000,
    asOf: 2022,
    trend: "down",
    region: "Tropical reefs worldwide",
    blurb:
      "Named for its narrow, pointed beak. Vital to reef health by eating sponges; hunted for its 'tortoiseshell'.",
    family: {
      label: "Kingdom → Species (taxonomy)",
      nodes: [
        "Animalia (Kingdom)",
        "Chordata (Phylum)",
        "Reptilia (Class)",
        "Testudines (Order)",
        "Cheloniidae (Family)",
        "Eretmochelys (Genus)",
        "E. imbricata (Species)"
      ]
    },
    evolution: {
      label: "Evolutionary lineage",
      nodes: [
        "Early reptiles (~315 Mya)",
        "Stem turtles, Odontochelys (~220 Mya)",
        "Marine turtles appear (~150 Mya)",
        "Cheloniidae (~60 Mya)",
        "Eretmochelys lineage",
        "Hawksbill (modern)"
      ]
    },
    roles: [
      { era: "Mesozoic", role: "predator", note: "Sea-turtle ancestors swam with marine reptiles, eating soft-bodied prey." },
      { era: "Holocene", role: "predator", note: "Specialist sponge-eater shaping reef communities." },
      { era: "Modern", role: "prey", note: "Eggs and adults taken by humans; shell trade nearly wiped them out." }
    ]
  },
  {
    id: "saola",
    name: "Saola",
    sci: "Pseudoryx nghetinhensis",
    emoji: "🦌",
    status: "Critically Endangered",
    population: 100,
    asOf: 2023,
    trend: "down",
    region: "Annamite Mountains, Vietnam & Laos",
    blurb:
      "The 'Asian unicorn' — so rare it was only discovered by science in 1992 and has never been kept alive in captivity.",
    family: {
      label: "Kingdom → Species (taxonomy)",
      nodes: [
        "Animalia (Kingdom)",
        "Chordata (Phylum)",
        "Mammalia (Class)",
        "Artiodactyla (Order)",
        "Bovidae (Family)",
        "Pseudoryx (Genus)",
        "P. nghetinhensis (Species)"
      ]
    },
    evolution: {
      label: "Evolutionary lineage",
      nodes: [
        "Early artiodactyls (~55 Mya)",
        "Ruminant ancestors (~45 Mya)",
        "Bovidae appear (~20 Mya)",
        "Bovid radiation (~15 Mya)",
        "Pseudoryx lineage (relict)",
        "Saola (modern relict)"
      ]
    },
    roles: [
      { era: "Pleistocene", role: "prey", note: "Forest bovid browsed by big cats and dholes." },
      { era: "Holocene", role: "prey", note: "Shy browser; natural predators are tigers and dholes." },
      { era: "Modern", role: "prey", note: "Almost entirely doomed by snares set for other animals." }
    ]
  },
  {
    id: "giant-panda",
    name: "Giant Panda",
    sci: "Ailuropoda melanoleuca",
    emoji: "🐼",
    status: "Vulnerable",
    population: 1864,
    asOf: 2014,
    trend: "up",
    region: "Mountain forests of central China",
    blurb:
      "Downlisted from Endangered to Vulnerable in 2016 — a flagship recovery driven by bamboo-forest protection.",
    family: {
      label: "Kingdom → Species (taxonomy)",
      nodes: [
        "Animalia (Kingdom)",
        "Chordata (Phylum)",
        "Mammalia (Class)",
        "Carnivora (Order)",
        "Ursidae (Family)",
        "Ailuropoda (Genus)",
        "A. melanoleuca (Species)"
      ]
    },
    evolution: {
      label: "Evolutionary lineage",
      nodes: [
        "Miacids (~60 Mya)",
        "Caniformia (~45 Mya)",
        "Early bears (~30 Mya)",
        "Ailuropoda split (~19 Mya)",
        "Ailurarctos (~8 Mya)",
        "Giant panda (modern)"
      ]
    },
    roles: [
      { era: "Pliocene", role: "predator", note: "Bear ancestors were true carnivores before switching to bamboo." },
      { era: "Holocene", role: "predator", note: "Technically a carnivore but ~99% bamboo diet; rarely eats meat." },
      { era: "Modern", role: "prey", note: "Cubs vulnerable to leopards and dholes; adults threatened by habitat loss." }
    ]
  }
];
