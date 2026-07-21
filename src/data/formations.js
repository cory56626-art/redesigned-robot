// Formation templates. Slot coordinates are normalised for a team attacking toward y=1:
//   x: 0 (left touchline) .. 1 (right touchline)
//   y: 0 (own goal line)   .. 1 (opponent goal line)
// `group` drives AI role behaviour; `pos` is the label shown in the UI and used for
// position-fit / OVR-by-position.

const S = (pos, group, x, y) => ({ pos, group, x, y });

export const FORMATIONS = {
  '442': {
    id: '442', name: '4-4-2',
    slots: [
      S('GK', 'GK', 0.5, 0.04),
      S('LB', 'FB', 0.16, 0.24), S('CB', 'CB', 0.38, 0.16), S('CB', 'CB', 0.62, 0.16), S('RB', 'FB', 0.84, 0.24),
      S('LM', 'W', 0.16, 0.5), S('CM', 'CM', 0.4, 0.46), S('CM', 'CM', 0.6, 0.46), S('RM', 'W', 0.84, 0.5),
      S('ST', 'ST', 0.4, 0.78), S('ST', 'ST', 0.6, 0.78),
    ],
  },
  '433': {
    id: '433', name: '4-3-3',
    slots: [
      S('GK', 'GK', 0.5, 0.04),
      S('LB', 'FB', 0.16, 0.26), S('CB', 'CB', 0.38, 0.16), S('CB', 'CB', 0.62, 0.16), S('RB', 'FB', 0.84, 0.26),
      S('CDM', 'DM', 0.5, 0.4), S('CM', 'CM', 0.32, 0.52), S('CM', 'CM', 0.68, 0.52),
      S('LW', 'W', 0.18, 0.78), S('ST', 'ST', 0.5, 0.82), S('RW', 'W', 0.82, 0.78),
    ],
  },
  '4231': {
    id: '4231', name: '4-2-3-1',
    slots: [
      S('GK', 'GK', 0.5, 0.04),
      S('LB', 'FB', 0.16, 0.26), S('CB', 'CB', 0.38, 0.16), S('CB', 'CB', 0.62, 0.16), S('RB', 'FB', 0.84, 0.26),
      S('CDM', 'DM', 0.38, 0.4), S('CDM', 'DM', 0.62, 0.4),
      S('LM', 'W', 0.18, 0.62), S('CAM', 'AM', 0.5, 0.64), S('RM', 'W', 0.82, 0.62),
      S('ST', 'ST', 0.5, 0.84),
    ],
  },
  '352': {
    id: '352', name: '3-5-2',
    slots: [
      S('GK', 'GK', 0.5, 0.04),
      S('CB', 'CB', 0.28, 0.17), S('CB', 'CB', 0.5, 0.14), S('CB', 'CB', 0.72, 0.17),
      S('LWB', 'FB', 0.1, 0.46), S('CM', 'CM', 0.36, 0.5), S('CDM', 'DM', 0.5, 0.42), S('CM', 'CM', 0.64, 0.5), S('RWB', 'FB', 0.9, 0.46),
      S('ST', 'ST', 0.4, 0.8), S('ST', 'ST', 0.6, 0.8),
    ],
  },
  'diamond': {
    id: 'diamond', name: '4-4-2 Diamond',
    slots: [
      S('GK', 'GK', 0.5, 0.04),
      S('LB', 'FB', 0.16, 0.26), S('CB', 'CB', 0.38, 0.16), S('CB', 'CB', 0.62, 0.16), S('RB', 'FB', 0.84, 0.26),
      S('CDM', 'DM', 0.5, 0.38), S('CM', 'CM', 0.26, 0.52), S('CM', 'CM', 0.74, 0.52), S('CAM', 'AM', 0.5, 0.66),
      S('ST', 'ST', 0.4, 0.82), S('ST', 'ST', 0.6, 0.82),
    ],
  },
  '532': {
    id: '532', name: '5-3-2',
    slots: [
      S('GK', 'GK', 0.5, 0.04),
      S('LWB', 'FB', 0.1, 0.3), S('CB', 'CB', 0.3, 0.15), S('CB', 'CB', 0.5, 0.13), S('CB', 'CB', 0.7, 0.15), S('RWB', 'FB', 0.9, 0.3),
      S('CM', 'CM', 0.3, 0.5), S('CM', 'CM', 0.5, 0.45), S('CM', 'CM', 0.7, 0.5),
      S('ST', 'ST', 0.4, 0.78), S('ST', 'ST', 0.6, 0.78),
    ],
  },
  '343': {
    id: '343', name: '3-4-3',
    slots: [
      S('GK', 'GK', 0.5, 0.04),
      S('CB', 'CB', 0.28, 0.17), S('CB', 'CB', 0.5, 0.14), S('CB', 'CB', 0.72, 0.17),
      S('LM', 'W', 0.14, 0.48), S('CM', 'CM', 0.4, 0.46), S('CM', 'CM', 0.6, 0.46), S('RM', 'W', 0.86, 0.48),
      S('LW', 'W', 0.2, 0.8), S('ST', 'ST', 0.5, 0.82), S('RW', 'W', 0.8, 0.8),
    ],
  },
  '451': {
    id: '451', name: '4-5-1',
    slots: [
      S('GK', 'GK', 0.5, 0.04),
      S('LB', 'FB', 0.16, 0.26), S('CB', 'CB', 0.38, 0.16), S('CB', 'CB', 0.62, 0.16), S('RB', 'FB', 0.84, 0.26),
      S('LM', 'W', 0.14, 0.52), S('CM', 'CM', 0.36, 0.48), S('CDM', 'DM', 0.5, 0.42), S('CM', 'CM', 0.64, 0.48), S('RM', 'W', 0.86, 0.52),
      S('ST', 'ST', 0.5, 0.82),
    ],
  },
};

export const FORMATION_LIST = Object.values(FORMATIONS);
export const formation = (id) => FORMATIONS[id] || FORMATIONS['442'];

// Position -> the group it belongs to, for OVR-by-position and squad validation.
export const POS_GROUP = {
  GK: 'GK',
  LB: 'FB', RB: 'FB', LWB: 'FB', RWB: 'FB',
  CB: 'CB',
  CDM: 'DM',
  CM: 'CM',
  CAM: 'AM',
  LM: 'W', RM: 'W', LW: 'W', RW: 'W',
  ST: 'ST', CF: 'ST',
};

// All selectable positions a player can natively have.
export const ALL_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'];
