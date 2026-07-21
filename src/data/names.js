// Fictional name pools grouped by cultural region, mapped from nation codes.
// Names are common given/family names — not intended to reference real people.

const POOLS = {
  iberic: {
    first: ['Diego', 'Mateo', 'Rafael', 'Bruno', 'Lucas', 'Thiago', 'Andrés', 'Pablo', 'Marco', 'Emilio', 'Nicolás', 'Iván', 'Rodrigo', 'Gael', 'Santiago', 'Álvaro', 'Joaquín', 'Sergio', 'Cristian', 'Vinícius'],
    last: ['Silva', 'Ferreira', 'Gómez', 'Torres', 'Ramos', 'Castro', 'Ríos', 'Vega', 'Moura', 'Cardoso', 'Herrera', 'Delgado', 'Navarro', 'Barros', 'Fonseca', 'Machado', 'Peralta', 'Cordeiro', 'Salgado', 'Bautista'],
  },
  english: {
    first: ['Jack', 'Harry', 'Oliver', 'George', 'Charlie', 'Ethan', 'Mason', 'Leo', 'Kai', 'Reece', 'Callum', 'Marcus', 'Dylan', 'Nathan', 'Aaron', 'Cole', 'Jordan', 'Tyler', 'Owen', 'Rhys'],
    last: ['Walker', 'Bennett', 'Carter', 'Hughes', 'Ward', 'Reid', 'Bailey', 'Foster', 'Chapman', 'Fletcher', 'Blackwood', 'Ashcroft', 'Hollis', 'Sinclair', 'Marsh', 'Ellison', 'Radcliffe', 'Thornton', 'Whitfield', 'Larkin'],
  },
  french: {
    first: ['Hugo', 'Louis', 'Théo', 'Enzo', 'Nathan', 'Ousmane', 'Yanis', 'Adrien', 'Corentin', 'Maxime', 'Loïc', 'Baptiste', 'Amaury', 'Florian', 'Kylian', 'Malo', 'Rayan', 'Noham', 'Ilan', 'Sacha'],
    last: ['Moreau', 'Lefèvre', 'Girard', 'Dubois', 'Rousseau', 'Fontaine', 'Perrin', 'Barré', 'Marchand', 'Renaud', 'Coste', 'Delaunay', 'Guerin', 'Mercier', 'Baptiste', 'Diomandé', 'Vidal', 'Charpentier', 'Aubert', 'Sylla'],
  },
  germanic: {
    first: ['Leon', 'Finn', 'Jonas', 'Luca', 'Niklas', 'Max', 'Timo', 'Erik', 'Lukas', 'Sven', 'Kasper', 'Jesper', 'Mats', 'Bram', 'Daan', 'Sander', 'Joris', 'Emil', 'Oscar', 'Viktor'],
    last: ['Müller', 'Wagner', 'Becker', 'Hoffmann', 'Vogel', 'Brandt', 'Kraus', 'Bakker', 'Visser', 'Jansen', 'Larsson', 'Nilsson', 'Berg', 'Lindqvist', 'Holm', 'Sørensen', 'Andersen', 'Dahl', 'Voss', 'Reinhart'],
  },
  italic: {
    first: ['Lorenzo', 'Matteo', 'Alessandro', 'Francesco', 'Gabriele', 'Riccardo', 'Federico', 'Davide', 'Simone', 'Giacomo', 'Tommaso', 'Antonio', 'Salvatore', 'Nicolò', 'Cristiano', 'Giulio', 'Pietro', 'Fabio', 'Enrico', 'Marco'],
    last: ['Rossi', 'Conti', 'Greco', 'Marino', 'Bruno', 'Gallo', 'Costa', 'Ferrari', 'Romano', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Marini', 'Bianchi', 'De Luca', 'Caruso', 'Longo', 'Rizzo', 'Vitale'],
  },
  slavic: {
    first: ['Luka', 'Marko', 'Ivan', 'Nikola', 'Filip', 'Stefan', 'Andrej', 'Dušan', 'Kamil', 'Jakub', 'Piotr', 'Bartosz', 'Mateusz', 'Vlad', 'Milan', 'Dejan', 'Kacper', 'Szymon', 'Aleksa', 'Vuk'],
    last: ['Novak', 'Petrović', 'Kovač', 'Horvat', 'Jović', 'Marković', 'Wójcik', 'Kowalski', 'Nowak', 'Lewinski', 'Zieliński', 'Vasilev', 'Ilić', 'Radić', 'Popović', 'Babić', 'Stankovic', 'Mazur', 'Krol', 'Dabrowski'],
  },
  african: {
    first: ['Sadio', 'Kalidou', 'Youssef', 'Amine', 'Ismaël', 'Bafodé', 'Cheikh', 'Moussa', 'Idrissa', 'Serge', 'Nabil', 'Wilfried', 'Odion', 'Chidera', 'Emeka', 'Kwame', 'Kofi', 'Yaw', 'Achraf', 'Zakaria'],
    last: ['Diallo', 'Traoré', 'Koné', 'Mensah', 'Owusu', 'Boateng', 'Osei', 'Ndoye', 'Sarr', 'Camara', 'Mendy', 'Bamba', 'Okafor', 'Eze', 'Nwosu', 'Benali', 'Ziyech', 'El Amrani', 'Toure', 'Fofana'],
  },
  eastasian: {
    first: ['Haruto', 'Ren', 'Sota', 'Yuto', 'Riku', 'Takumi', 'Kaito', 'Minjun', 'Seojun', 'Doyun', 'Jiho', 'Hyun', 'Sung', 'Jae', 'Kenji', 'Daiki', 'Sho', 'Woojin', 'Eunwoo', 'Taeyang'],
    last: ['Tanaka', 'Sato', 'Suzuki', 'Watanabe', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Yoon', 'Ito', 'Ono', 'Hwang', 'Son', 'Cho', 'Fujimoto'],
  },
  arab: {
    first: ['Mohamed', 'Ahmed', 'Omar', 'Karim', 'Hassan', 'Youssef', 'Bilal', 'Tariq', 'Faisal', 'Sami', 'Anas', 'Ziad', 'Nasser', 'Rami', 'Adel', 'Walid', 'Hamza', 'Yahya', 'Majed', 'Salem'],
    last: ['Al-Hassan', 'Al-Rashid', 'Mansour', 'Haddad', 'Nasser', 'Farouk', 'Saleh', 'Khalil', 'Rahman', 'Aziz', 'Salman', 'Al-Dosari', 'Al-Farsi', 'Hijazi', 'Barakat', 'Qasim', 'Younis', 'Shaheen', 'Karam', 'Nabil'],
  },
};

// Map nation code -> name pool key.
const NATION_POOL = {
  BR: 'iberic', AR: 'iberic', UY: 'iberic', CO: 'iberic', CL: 'iberic', EC: 'iberic', MX: 'iberic', ES: 'iberic', PT: 'iberic',
  EN: 'english', SC: 'english', US: 'english', CA: 'english', AU: 'english',
  FR: 'french',
  DE: 'germanic', NL: 'germanic', SE: 'germanic', NO: 'germanic', DK: 'germanic', AT: 'germanic', CH: 'germanic', BE: 'germanic',
  IT: 'italic',
  HR: 'slavic', PL: 'slavic', RS: 'slavic', GR: 'slavic', TR: 'slavic',
  SN: 'african', NG: 'african', GH: 'african', CM: 'african', CI: 'african', MA: 'arab', EG: 'arab',
  JP: 'eastasian', KR: 'eastasian',
  SA: 'arab', IR: 'arab',
};

export function generateName(nationCode, rng) {
  const pool = POOLS[NATION_POOL[nationCode] || 'english'];
  const first = rng.pick(pool.first);
  const last = rng.pick(pool.last);
  return { first, last, name: `${first} ${last}` };
}
