import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const MAX_DELIVERED_FILES = 12

/** Register the explicit handoff from shell/external file creation to the client artifact surface. */
export function applyDeliverFilesTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'deliver_files',
    description: 'Register existing workspace files as user-visible deliverables. File delivery is part of task completion: call this in the same turn after any tool creates, modifies, converts, or exports final files for the user, without waiting for a follow-up request. It makes the files appear as clickable output chips. Include final outputs only; this tool does not create or edit files.',
    parameters: {
      paths: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: `One to ${MAX_DELIVERED_FILES} existing file paths inside the session workspace.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paths: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Registered deliverables:\n${value.paths.map(path => `- ${path}`).join('\n')}`,
      }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('deliver_files requires a session workspace')
      if (args.paths.length === 0 || args.paths.length > MAX_DELIVERED_FILES) {
        throw new Error(`deliver_files accepts 1-${MAX_DELIVERED_FILES} files`)
      }
      const root = await ctx.fs.resolve(cwd, { signal: exec.signal })
      const rootInfo = await ctx.fs.stat(root, exec.signal)
      if (rootInfo?.type !== 'directory') throw new Error('deliver_files session workspace is not a directory')
      const accepted: string[] = []
      const seen = new Set<string>()
      for (const raw of args.paths) {
        if (raw.trim() === '') throw new Error('deliver_files paths must be non-empty')
        const target = await ctx.fs.resolve(raw, { cwd, signal: exec.signal })
        if (!ctx.fs.contains(root, target)) throw new Error(`deliver_files path is outside the workspace: ${raw}`)
        if ((await ctx.fs.stat(target, exec.signal))?.type !== 'file') {
          throw new Error(`deliver_files path is not a file: ${raw}`)
        }
        if (seen.has(raw)) continue
        seen.add(raw)
        accepted.push(raw)
      }
      return { paths: accepted }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.paths.length === 1 ? `Deliver ${args.paths[0] ?? 'file'}` : `Deliver ${args.paths.length} files`,
      kind: 'edit',
      locations: args.paths.map(path => ({ path })),
    }),
  }))
}
