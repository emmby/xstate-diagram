import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { processInput } from './cli';
import { assertValidMermaid } from './test-helper';

describe('Phase 3: Basic Mermaid String Compilation', () => {
  let originalConsoleLog: any;
  let consoleOutput: string[] = [];

  beforeAll(() => {
    originalConsoleLog = console.log;
  });
  
  beforeEach(() => {
    consoleOutput = [];
    console.log = (msg: string) => { consoleOutput.push(msg); };
  });

  afterAll(() => {
    console.log = originalConsoleLog;
  });

  it('should compile a basic flat state machine mapping reliably', () => {
    const specPath = path.join(__dirname, '../specs/basic_flat_machine.json');
    const validConfig = fs.readFileSync(specPath, 'utf8');
    
    processInput(validConfig);
    assertValidMermaid(consoleOutput[0], 'basic_flat_machine');
  });

  it('should stringently map transition events with guards and multifaceted actions', () => {
    const specPath = path.join(__dirname, '../specs/advanced_transitions.json');
    const complexTransitionConfig = fs.readFileSync(specPath, 'utf8');
    
    processInput(complexTransitionConfig);
    assertValidMermaid(consoleOutput[0], 'advanced_transitions');
  });

  it('should map flat self-transitions gracefully', () => {
    const specPath = path.join(__dirname, '../specs/self_transitions.json');
    const selfConfig = fs.readFileSync(specPath, 'utf8');
    
    processInput(selfConfig);
    assertValidMermaid(consoleOutput[0], 'self_transitions');
  });

  it('should implement safe aliases when parsing keys with spaces or special characters', () => {
    const specPath = path.join(__dirname, '../specs/safe_aliases.json');
    const spaceConfig = fs.readFileSync(specPath, 'utf8');
    
    processInput(spaceConfig);
    assertValidMermaid(consoleOutput[0], 'safe_aliases');
  });

  it('should fail elegantly with invalid JSON syntax', () => {
    expect(() => {
      processInput('{"id": "bad", '); // broken json
    }).toThrow(/Input is not valid JSON/);
  });
});
