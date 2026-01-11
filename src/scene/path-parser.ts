import type { PathCommand } from '../renderer/types';

/**
 * Parse SVG path data string into PathCommand array
 */
export function parsePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const tokens = tokenizePath(d);
  let i = 0;

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    i++;

    const isRelative = cmd === cmd.toLowerCase();
    const command = cmd.toUpperCase();

    switch (command) {
      case 'M': {
        const x = parseFloat(tokens[i++]);
        const y = parseFloat(tokens[i++]);
        const absX = isRelative ? currentX + x : x;
        const absY = isRelative ? currentY + y : y;
        commands.push({ type: 'M', x: absX, y: absY });
        currentX = absX;
        currentY = absY;
        startX = absX;
        startY = absY;

        // Additional coordinate pairs are treated as lineto
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const lx = parseFloat(tokens[i++]);
          const ly = parseFloat(tokens[i++]);
          const absLX = isRelative ? currentX + lx : lx;
          const absLY = isRelative ? currentY + ly : ly;
          commands.push({ type: 'L', x: absLX, y: absLY });
          currentX = absLX;
          currentY = absLY;
        }
        break;
      }

      case 'L': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;
          commands.push({ type: 'L', x: absX, y: absY });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'H': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x = parseFloat(tokens[i++]);
          const absX = isRelative ? currentX + x : x;
          commands.push({ type: 'H', x: absX });
          currentX = absX;
        }
        break;
      }

      case 'V': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const y = parseFloat(tokens[i++]);
          const absY = isRelative ? currentY + y : y;
          commands.push({ type: 'V', y: absY });
          currentY = absY;
        }
        break;
      }

      case 'C': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x1 = parseFloat(tokens[i++]);
          const y1 = parseFloat(tokens[i++]);
          const x2 = parseFloat(tokens[i++]);
          const y2 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX1 = isRelative ? currentX + x1 : x1;
          const absY1 = isRelative ? currentY + y1 : y1;
          const absX2 = isRelative ? currentX + x2 : x2;
          const absY2 = isRelative ? currentY + y2 : y2;
          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({
            type: 'C',
            x1: absX1, y1: absY1,
            x2: absX2, y2: absY2,
            x: absX, y: absY
          });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'S': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x2 = parseFloat(tokens[i++]);
          const y2 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX2 = isRelative ? currentX + x2 : x2;
          const absY2 = isRelative ? currentY + y2 : y2;
          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({
            type: 'S',
            x2: absX2, y2: absY2,
            x: absX, y: absY
          });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'Q': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x1 = parseFloat(tokens[i++]);
          const y1 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX1 = isRelative ? currentX + x1 : x1;
          const absY1 = isRelative ? currentY + y1 : y1;
          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({
            type: 'Q',
            x1: absX1, y1: absY1,
            x: absX, y: absY
          });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'T': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({ type: 'T', x: absX, y: absY });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'A': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const rx = parseFloat(tokens[i++]);
          const ry = parseFloat(tokens[i++]);
          const angle = parseFloat(tokens[i++]);
          const largeArc = tokens[i++] === '1';
          const sweep = tokens[i++] === '1';
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({
            type: 'A',
            rx, ry, angle, largeArc, sweep,
            x: absX, y: absY
          });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'Z': {
        commands.push({ type: 'Z' });
        currentX = startX;
        currentY = startY;
        break;
      }
    }
  }

  return commands;
}

function tokenizePath(d: string): string[] {
  const tokens: string[] = [];
  const regex = /([MmLlHhVvCcSsQqTtAaZz])|(-?[\d.]+)/g;
  let match;

  while ((match = regex.exec(d)) !== null) {
    tokens.push(match[0]);
  }

  return tokens;
}
