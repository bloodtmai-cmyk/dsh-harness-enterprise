/** Node-half coverage for the model guidance paired with Web file references. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply, inject } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('ui-deliverables node plugin', () => {
  it('registers final-response file-reference guidance only while mounted', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()

    const section = (await ctx.systemPrompt.assemble()).sections
      .find(entry => entry.name === 'ui:deliverable-file-references')
    expect(section?.text).toMatchInlineSnapshot('"File delivery is part of completing every file-processing task. After successfully creating, modifying, converting, or exporting any user-facing file, call `deliver_files` in the same turn with every final output path, regardless of which tool performed the work and without waiting for the user to ask for the file. Register only final deliverables, not temporary or intermediate files; use multiple `deliver_files` calls when one call cannot hold every final output. Do not claim that a file is attached, available, or downloadable until `deliver_files` succeeds. Do not install document-processing dependencies at runtime merely to create an Office deliverable; use a provisioned document tool, or report that the capability is unavailable. In the final response, mention each delivered file as Markdown inline code using its exact registered path, or a basename only when it is unique among the files changed in that turn, so the user receives a clickable link immediately."')
    await mounted.dispose()
    expect((await ctx.systemPrompt.assemble()).sections
      .some(entry => entry.name === 'ui:deliverable-file-references')).toBe(false)
  })
})
