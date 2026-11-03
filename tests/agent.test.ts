import { describe, expect, it } from 'vitest';
import { mapRecord } from '../src/airtable/mapRecord.js';
import { openDatabase } from '../src/db/database.js';
import { replaceBase } from '../src/db/repo.js';
import { answerQuestion } from '../src/llm/agent.js';
import { testConfig } from './helpers.js';

describe('agente', () => {
  it('usa la herramienta de conteo y no deja pasar un mail inventado por el modelo', async () => {
    const db = openDatabase(':memory:');
    replaceBase(db, 'general', [
      mapRecord('general', {
        id: 'recJavaSenior0001',
        fields: {
          'Name & Lastname': 'Ada López',
          Email: 'ada@example.com',
          Password: 'hunter2',
          Seniority: 'Sr',
          'Skills 2': ['Java'],
          'Clausula Datos': true,
        },
      }),
    ]);
    const bodies: string[] = [];
    let step = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push(String(init?.body ?? ''));
      step += 1;
      if (step === 1) {
        return Response.json({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'count_candidates',
                      arguments: JSON.stringify({ skills: ['Java'], seniority: ['Sr'] }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return Response.json({
        choices: [
          {
            message: {
              content: 'Hay 1 perfil senior con Java. El mail es ada@example.com y el tel es +54 11 5555 4444.',
            },
          },
        ],
      });
    };

    const answer = await answerQuestion({
      question: 'cuántos java senior hay',
      db,
      config: testConfig({ llmApiKey: 'test-key', chatDetailLevel: 'counts' }),
      fetchImpl,
    });
    expect(answer).toMatch(/Hay 1 perfil/);
    expect(answer).not.toMatch(/ada@example.com|5555|hunter2/);
    const second = JSON.parse(bodies[1] ?? '{}') as { messages?: Array<{ role?: string; content?: string }> };
    const tool = second.messages?.find((message) => message.role === 'tool');
    expect(tool?.content).toContain('"total":1');
    expect(tool?.content).not.toContain('ada@example.com');
    expect(tool?.content).not.toContain('hunter2');
  });
});
