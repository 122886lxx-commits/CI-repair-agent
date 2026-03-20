import OpenAI from "openai";

import { getConfig } from "@/server/config";
import type { DiffCandidate, FailureContext, TaskSpec } from "@/server/domain/types";

export interface ModelProvider {
  proposePatch(repo: string, taskSpec: TaskSpec, failureContext: FailureContext): Promise<DiffCandidate>;
}

export function createModelProvider(): ModelProvider {
  const config = getConfig();
  if (config.OPENAI_API_KEY) {
    return new OpenAIModelProvider(config.OPENAI_API_KEY, config.OPENAI_MODEL);
  }
  return new HeuristicModelProvider();
}

class HeuristicModelProvider implements ModelProvider {
  async proposePatch(repo: string, taskSpec: TaskSpec, failureContext: FailureContext): Promise<DiffCandidate> {
    const likelyPath = inferLikelyPath(failureContext.logExcerpt);
    return {
      rationale: `Generated a dry-run repair suggestion for ${repo} based on failure step "${failureContext.failedStep}".`,
      patch: [
        `diff --git a/${likelyPath} b/${likelyPath}`,
        `--- a/${likelyPath}`,
        `+++ b/${likelyPath}`,
        "@@",
        `-// TODO: failing behavior`,
        `+// Suggested guard based on CI failure: ${failureContext.failedStep}`
      ].join("\n"),
      files: [
        {
          path: likelyPath,
          changeType: "modified",
          additions: 1,
          deletions: 1,
          summary: `Add a guard or config fix related to ${failureContext.failedStep}`
        }
      ],
      riskFlags: []
    };
  }
}

class OpenAIModelProvider implements ModelProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async proposePatch(repo: string, taskSpec: TaskSpec, failureContext: FailureContext): Promise<DiffCandidate> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are a CI repair planner.",
                "Return JSON with keys: rationale, patch, files.",
                "files must be an array of { path, changeType, additions, deletions, summary }.",
                "Use unified diff format in patch."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  repo,
                  taskSpec,
                  failureContext
                },
                null,
                2
              )
            }
          ]
        }
      ]
    });

    const raw = response.output_text;
    const parsed = JSON.parse(raw) as DiffCandidate;
    return {
      ...parsed,
      riskFlags: parsed.riskFlags ?? []
    };
  }
}

function inferLikelyPath(logExcerpt: string) {
  if (/eslint|prettier/i.test(logExcerpt)) {
    return ".eslintrc.cjs";
  }
  if (/package|module/i.test(logExcerpt)) {
    return "package.json";
  }
  if (/workflow|action/i.test(logExcerpt)) {
    return ".github/workflows/ci.yml";
  }
  return "src/index.ts";
}
