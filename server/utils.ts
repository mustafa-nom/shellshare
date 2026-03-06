import { randomBytes } from 'crypto';

export const COLORS = [
  { name: 'blue', hex: '#58a6ff' },
  { name: 'green', hex: '#3fb950' },
  { name: 'yellow', hex: '#d29922' },
  { name: 'red', hex: '#f85149' },
  { name: 'purple', hex: '#bc8cff' },
  { name: 'orange', hex: '#f0883e' },
  { name: 'lime', hex: '#39d353' },
  { name: 'pink', hex: '#db61a2' },
  { name: 'cyan', hex: '#79c0ff' },
  { name: 'mint', hex: '#7ee787' },
];

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

export function genId(): string {
  return randomBytes(8).toString('hex');
}

export function genSessionToken(): string {
  return 's_' + randomBytes(32).toString('hex');
}

export function genRoomCode(): string {
  let code = '';
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += ROOM_CODE_CHARS[bytes[i] % ROOM_CODE_CHARS.length];
    if (i === 3) code += '-';
  }
  return code;
}

export function getNextColor(takenColors: Set<string>): { name: string; hex: string } {
  for (const color of COLORS) {
    if (!takenColors.has(color.name)) return color;
  }
  // All taken, wrap around
  return COLORS[takenColors.size % COLORS.length];
}

export function cowsay(text: string): string {
  const maxLen = 40;
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > maxLen && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);

  const width = Math.max(...lines.map((l) => l.length));
  const border = ' ' + '_'.repeat(width + 2);
  const bottom = ' ' + '-'.repeat(width + 2);

  let body: string;
  if (lines.length === 1) {
    body = `< ${lines[0].padEnd(width)} >`;
  } else {
    body = lines
      .map((line, i) => {
        const padded = line.padEnd(width);
        if (i === 0) return `/ ${padded} \\`;
        if (i === lines.length - 1) return `\\ ${padded} /`;
        return `| ${padded} |`;
      })
      .join('\n');
  }

  const cow = `        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`;

  return `${border}\n${body}\n${bottom}\n${cow}`;
}

export function userToInfo(user: { id: string; name: string; color: string; colorName: string; isAdmin: boolean; joinOrder: number; role?: 'driver' | 'spectator' }) {
  return {
    id: user.id,
    name: user.name,
    color: user.color,
    colorName: user.colorName,
    isAdmin: user.isAdmin,
    joinOrder: user.joinOrder,
    role: user.role,
  };
}
