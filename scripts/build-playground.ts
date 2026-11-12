import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PRESETS = {
  checkout: {
    name: 'E-Commerce Checkout (Tier 2: Guards, Compartments & Invoke)',
    config: {
      id: 'checkout',
      initial: 'cart',
      states: {
        cart: {
          entry: ['loadSavedCart'],
          tags: ['editable'],
          on: {
            ADD_ITEM: {
              actions: ['assignItem', 'recalculateSubtotal'],
            },
            CHECKOUT: [
              {
                guard: 'hasValidItems',
                target: 'payment',
                actions: ['lockCart'],
              },
              {
                target: 'cartError',
                actions: ['flagEmptyCart'],
              },
            ],
          },
        },
        cartError: {
          on: {
            RETRY: 'cart',
          },
        },
        payment: {
          entry: ['initPaymentIntent'],
          invoke: {
            id: 'stripeCharge',
            src: 'chargeCardActor',
            onDone: {
              target: 'confirmed',
              actions: ['recordTransaction', 'sendReceiptEmail'],
            },
            onError: {
              target: 'cart',
              actions: ['notifyPaymentFailure'],
            },
          },
        },
        confirmed: {
          type: 'final',
        },
      },
    },
  },
  traffic: {
    name: 'Pedestrian Traffic Signal (Tier 2: Delayed after & always)',
    config: {
      id: 'trafficSignal',
      initial: 'green',
      states: {
        green: {
          entry: ['illuminateGreen'],
          after: {
            4000: 'yellow',
          },
          on: {
            PEDESTRIAN_BUTTON: {
              guard: 'walkRequestAllowed',
              target: 'yellow',
              actions: ['queueWalkCycle'],
            },
          },
        },
        yellow: {
          entry: ['illuminateYellow'],
          after: {
            1500: 'red',
          },
        },
        red: {
          entry: ['illuminateRed'],
          after: {
            5000: 'checkQueue',
          },
        },
        checkQueue: {
          always: [
            {
              guard: 'EmergencyOverrideActive',
              target: 'red',
            },
            {
              target: 'green',
              actions: ['clearWalkQueue'],
            },
          ],
        },
      },
    },
  },
  authHierarchy: {
    name: 'Hierarchical Auth & MFA Session (Tier 3: Compound States & onDone)',
    config: {
      id: 'authSession',
      initial: 'signedOut',
      states: {
        signedOut: {
          on: {
            LOGIN_START: 'authenticating',
          },
        },
        authenticating: {
          initial: 'credentials',
          onDone: {
            target: 'authenticated',
            actions: ['issueSessionToken'],
          },
          on: {
            CANCEL: 'signedOut',
          },
          states: {
            credentials: {
              on: {
                SUBMIT_CREDENTIALS: [
                  {
                    guard: 'requiresMfa',
                    target: 'mfaChallenge',
                  },
                  {
                    target: 'verified',
                  },
                ],
              },
            },
            mfaChallenge: {
              on: {
                VERIFY_OTP: {
                  guard: 'isValidOtp',
                  target: 'verified',
                },
                BACK: 'credentials',
              },
            },
            verified: {
              type: 'final',
            },
          },
        },
        authenticated: {
          entry: ['startHeartbeat'],
          exit: ['clearSessionStorage'],
          on: {
            LOGOUT: 'signedOut',
          },
        },
      },
    },
  },
  parallelPlayer: {
    name: 'Parallel Media Player with History (Tier 4: Parallel + H/H*)',
    config: {
      id: 'mediaPlayer',
      initial: 'active',
      states: {
        active: {
          type: 'parallel',
          on: {
            SLEEP: 'standby',
          },
          states: {
            playback: {
              initial: 'playing',
              states: {
                playing: {
                  on: { PAUSE: 'paused' },
                },
                paused: {
                  on: { PLAY: 'playing' },
                },
                hist: {
                  type: 'history',
                  history: 'shallow',
                },
              },
            },
            audio: {
              initial: 'unmuted',
              states: {
                unmuted: {
                  on: { MUTE: 'muted' },
                },
                muted: {
                  on: { UNMUTE: 'unmuted' },
                },
              },
            },
          },
        },
        standby: {
          on: {
            WAKE: '#mediaPlayer.active.playback.hist',
          },
        },
      },
    },
  },
};

function buildHtml(): string {
  const presetsJson = JSON.stringify(PRESETS, null, 2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>xstate-diagram — Interactive SVG Statechart Playground</title>
  <style>
    :root {
      --bg: #0f172a;
      --panel: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --danger: #f87171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .badge {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.35);
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .cli-pill {
      font-family: Menlo, Consolas, "DejaVu Sans Mono", monospace;
      font-size: 12px;
      background: #0b1120;
      border: 1px solid var(--border);
      color: #e2e8f0;
      padding: 6px 12px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    select, button {
      background: #0b1120;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    select:hover, button:hover {
      border-color: var(--accent);
    }
    button.primary {
      background: var(--accent);
      color: #0f172a;
      border-color: var(--accent);
      font-weight: 600;
    }
    button.primary:hover {
      background: var(--accent-hover);
    }
    main {
      display: grid;
      grid-template-columns: 420px 1fr;
      flex: 1;
      min-height: 0;
    }
    @media (max-width: 900px) {
      main {
        grid-template-columns: 1fr;
        grid-template-rows: 40vh 1fr;
      }
    }
    .editor-pane {
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
      background: #0b1120;
      min-height: 0;
    }
    .pane-header {
      padding: 8px 14px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    textarea {
      flex: 1;
      width: 100%;
      background: transparent;
      color: #e2e8f0;
      border: none;
      padding: 14px;
      font-family: Menlo, Consolas, "DejaVu Sans Mono", monospace;
      font-size: 12.5px;
      line-height: 1.5;
      resize: none;
      outline: none;
    }
    .error-banner {
      background: rgba(248, 113, 113, 0.14);
      border-top: 1px solid var(--danger);
      color: #fecaca;
      padding: 10px 14px;
      font-family: Menlo, Consolas, monospace;
      font-size: 12px;
      display: none;
    }
    .preview-pane {
      display: flex;
      flex-direction: column;
      background: #f8fafc;
      min-height: 0;
      position: relative;
    }
    .preview-canvas {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .preview-canvas svg {
      max-width: 100%;
      height: auto;
      box-shadow: 0 4px 20px rgba(15, 23, 42, 0.08);
      border-radius: 8px;
      background: #ffffff;
    }
    .metrics-bar {
      padding: 6px 14px;
      background: #e2e8f0;
      color: #334155;
      font-size: 12px;
      font-family: Menlo, Consolas, monospace;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
    }
    a.gh-link {
      color: var(--accent);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
    }
    a.gh-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>xstate-diagram</h1>
      <span class="badge">v0.2.1 • Pure-JS ELK + XState v5</span>
      <div class="cli-pill" title="Run directly from terminal with npx">
        <span>$ npx xstate-diagram machine.ts -o diagram.svg</span>
      </div>
    </div>
    <div class="toolbar">
      <label for="presetSelect" style="font-size:12px;color:var(--muted)">Preset:</label>
      <select id="presetSelect"></select>
      <label for="dirSelect" style="font-size:12px;color:var(--muted)">Direction:</label>
      <select id="dirSelect">
        <option value="AUTO">AUTO (Adaptive)</option>
        <option value="RIGHT">RIGHT (Horizontal)</option>
        <option value="DOWN">DOWN (Vertical)</option>
      </select>
      <button id="copySvgBtn">Copy SVG</button>
      <button id="downloadSvgBtn" class="primary">Download .svg</button>
      <a class="gh-link" href="https://github.com/emmby/xstate-diagram" target="_blank" rel="noopener">GitHub ↗</a>
    </div>
  </header>
  <main>
    <section class="editor-pane">
      <div class="pane-header">
        <span>XSTATE V5 MACHINE CONFIG (JSON)</span>
        <span id="statusText">Live rendering</span>
      </div>
      <textarea id="jsonEditor" spellcheck="false"></textarea>
      <div id="errorBanner" class="error-banner"></div>
    </section>
    <section class="preview-pane">
      <div id="previewCanvas" class="preview-canvas"></div>
      <div class="metrics-bar">
        <span id="metricsInfo">Ready</span>
        <span>100% Browser-Free Runtime • Deterministic SVG Statechart Engine</span>
      </div>
    </section>
  </main>

  <script type="module">
    import { renderMachineToSvg, extractFromMachine } from './xstate-diagram.bundle.js';

    const PRESETS = ${presetsJson};
    const presetSelect = document.getElementById('presetSelect');
    const dirSelect = document.getElementById('dirSelect');
    const jsonEditor = document.getElementById('jsonEditor');
    const errorBanner = document.getElementById('errorBanner');
    const previewCanvas = document.getElementById('previewCanvas');
    const metricsInfo = document.getElementById('metricsInfo');
    const copySvgBtn = document.getElementById('copySvgBtn');
    const downloadSvgBtn = document.getElementById('downloadSvgBtn');

    let latestSvg = '';
    let latestMachineId = 'diagram';

    for (const [key, preset] of Object.entries(PRESETS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = preset.name;
      presetSelect.appendChild(opt);
    }

    async function updateDiagram() {
      try {
        const raw = jsonEditor.value;
        const config = JSON.parse(raw);
        const direction = dirSelect.value;
        const t0 = performance.now();
        const ast = extractFromMachine(config);
        const svg = await renderMachineToSvg(config, { direction });
        const elapsed = (performance.now() - t0).toFixed(1);

        latestSvg = svg;
        latestMachineId = ast.machineId || 'diagram';
        previewCanvas.innerHTML = svg;
        errorBanner.style.display = 'none';

        const stateCount = Object.keys(ast.nodes).length;
        const edgeCount = ast.transitions.length;
        metricsInfo.textContent = \`Machine: \${ast.machineId} • \${stateCount} states • \${edgeCount} external transitions • Direction: \${direction} • Rendered in \${elapsed}ms\`;
      } catch (err) {
        errorBanner.style.display = 'block';
        errorBanner.textContent = err instanceof Error ? err.message : String(err);
      }
    }

    presetSelect.addEventListener('change', () => {
      const chosen = PRESETS[presetSelect.value];
      if (chosen) {
        jsonEditor.value = JSON.stringify(chosen.config, null, 2);
        updateDiagram();
      }
    });

    dirSelect.addEventListener('change', updateDiagram);

    let debounceTimer;
    jsonEditor.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateDiagram, 180);
    });

    copySvgBtn.addEventListener('click', async () => {
      if (!latestSvg) return;
      await navigator.clipboard.writeText(latestSvg);
      const prev = copySvgBtn.textContent;
      copySvgBtn.textContent = 'Copied!';
      setTimeout(() => { copySvgBtn.textContent = prev; }, 1400);
    });

    downloadSvgBtn.addEventListener('click', () => {
      if (!latestSvg) return;
      const blob = new Blob([latestSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`\${latestMachineId}.svg\`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Load initial preset
    jsonEditor.value = JSON.stringify(PRESETS.checkout.config, null, 2);
    updateDiagram();
  </script>
</body>
</html>
`;
}

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), 'dist/playground');
  await mkdir(outDir, { recursive: true });

  const bundlePath = resolve(outDir, 'xstate-diagram.bundle.js');
  const esbuildBin = resolve(process.cwd(), 'node_modules/.bin/esbuild');

  await execFileAsync(esbuildBin, [
    resolve(process.cwd(), 'src/index.ts'),
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--minify',
    `--outfile=${bundlePath}`,
  ]);

  const htmlPath = resolve(outDir, 'index.html');
  await writeFile(htmlPath, buildHtml(), 'utf8');
  process.stdout.write(`Built interactive playground at ${htmlPath}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
