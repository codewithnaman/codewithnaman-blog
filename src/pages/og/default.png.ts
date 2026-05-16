/* global process, Response */
/**
 * Default OG image endpoint.
 *
 * Generates a 1200×630 PNG used as the fallback OG image for pages
 * that don't have a post-specific OG image (e.g. homepage, listing pages).
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from '../../config';

const WIDTH = 1200;
const HEIGHT = 630;

const fontsDir = join(process.cwd(), 'node_modules/@fontsource/inter/files');
const fontRegular = readFileSync(join(fontsDir, 'inter-latin-400-normal.woff'));
const fontBold = readFileSync(join(fontsDir, 'inter-latin-700-normal.woff'));

export async function GET() {
  const markup = {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1e3a5f 0%, #2a408e 40%, #4a6cf7 100%)',
        padding: '40px',
      },
      children: {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '16px',
            width: '100%',
            height: '100%',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        backgroundColor: '#ffffff',
                      },
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: '48px',
                        fontWeight: 700,
                        color: '#ffffff',
                      },
                      children: SITE.title,
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  fontSize: '24px',
                  color: '#c7d2fe',
                  textAlign: 'center',
                  maxWidth: '600px',
                  lineHeight: 1.5,
                },
                children: SITE.description,
              },
            },
          ],
        },
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(markup as any, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: 'Inter', data: fontRegular, weight: 400, style: 'normal' },
      { name: 'Inter', data: fontBold, weight: 700, style: 'normal' },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });
  const pngData = resvg.render();

  return new Response(new Uint8Array(pngData.asPng()), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
