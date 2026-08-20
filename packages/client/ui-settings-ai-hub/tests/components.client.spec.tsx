// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiHubMarketSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  AuthorizedCapabilitiesSection,
  type AuthorizedCapabilitiesSectionProps,
} from '../src/client/AuthorizedCapabilitiesSection.tsx'
import {
  EnterpriseMarketRoot,
  ManagedUpdateAction,
  type EnterpriseMarketRootProps,
  type ManagedUpdateActionProps,
} from '../src/client/EnterpriseMarketRoot.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh): string => zh[key]

afterEach(cleanup)

function props(market: AuthorizedCapabilitiesSectionProps['market'], request = vi.fn()): AuthorizedCapabilitiesSectionProps {
  return { market, request, t }
}

const snapshot: AiHubMarketSnapshot = {
  available: true,
  evaluatedAt: '2026-08-17T08:00:00Z',
  items: [
    { capability: { id: 'mcp-1', type: 'MCP', externalRef: 'workbuddy', name: 'WorkBuddy', releaseVersion: '1.0.0' }, state: 'AUTHORIZED' },
    { capability: { id: 'skill-1', type: 'SKILL', externalRef: 'stock', name: '库存助手', releaseVersion: '1.0.0' }, state: 'AVAILABLE' },
    { capability: { id: 'bundle-1', type: 'BUNDLE', externalRef: 'stock-suite', name: '库存套件', releaseVersion: '1.0.0' }, state: 'PENDING' },
    { capability: { id: 'plugin-1', type: 'CLIENT_PLUGIN', externalRef: 'agent-reach', name: 'Agent Reach', releaseVersion: '1.5.0' }, state: 'AVAILABLE' },
  ],
}

describe('AuthorizedCapabilitiesSection', () => {
  it('shows published MCP, Skill, Bundle, and client plugin metadata', async () => {
    render(<AuthorizedCapabilitiesSection {...props(vi.fn().mockResolvedValue(snapshot))} />)

    expect(await screen.findByText('WorkBuddy')).toBeTruthy()
    expect(screen.getByText('库存助手')).toBeTruthy()
    expect(screen.getByText('库存套件')).toBeTruthy()
    expect(screen.getByText('Agent Reach')).toBeTruthy()
  })

  it('submits a request and refreshes the market state', async () => {
    const market = vi.fn().mockResolvedValue(snapshot)
    const request = vi.fn().mockResolvedValue(undefined)
    render(<AuthorizedCapabilitiesSection {...props(market, request)} />)
    await screen.findByText('Agent Reach')

    const cards = screen.getAllByRole('listitem')
    const agentReach = cards.find(card => card.textContent?.includes('Agent Reach'))
    expect(agentReach).toBeTruthy()
    fireEvent.click(agentReach!.querySelector('button')!)
    fireEvent.change(agentReach!.querySelector('textarea')!, { target: { value: '企业调研场景' } })
    fireEvent.submit(agentReach!.querySelector('form')!)

    await waitFor(() => { expect(request).toHaveBeenCalledWith('plugin-1', '企业调研场景') })
  })

  it('filters cards by capability kind with stable controls', async () => {
    render(<AuthorizedCapabilitiesSection {...props(vi.fn().mockResolvedValue(snapshot))} />)
    await screen.findByText('WorkBuddy')

    fireEvent.click(screen.getByRole('button', { name: /Skill/ }))
    await waitFor(() => { expect(screen.queryByText('WorkBuddy')).toBeNull() })
    expect(screen.getByText('库存助手')).toBeTruthy()
    expect(screen.queryByText('库存套件')).toBeNull()
  })

  it('searches capabilities by display name or stable identifier', async () => {
    render(<AuthorizedCapabilitiesSection {...props(vi.fn().mockResolvedValue(snapshot))} />)
    await screen.findByText('WorkBuddy')

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索企业能力' }), {
      target: { value: 'agent-reach' },
    })

    await waitFor(() => { expect(screen.queryByText('WorkBuddy')).toBeNull() })
    expect(screen.getByText('Agent Reach')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('显示 1 项，共 4 项')
  })

  it('supports an explicit retry after a Remote failure', async () => {
    const market = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot)
    render(<AuthorizedCapabilitiesSection {...props(market)} />)

    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    expect(await screen.findByText('WorkBuddy')).toBeTruthy()
    expect(market).toHaveBeenCalledTimes(2)
  })

  it('binds the executable WeCom client plugin with an in-Harness QR flow', async () => {
    const weComSnapshot: AiHubMarketSnapshot = {
      available: true,
      evaluatedAt: '2026-08-18T10:00:00Z',
      items: [{
        capability: {
          id: 'plugin-wecom', type: 'CLIENT_PLUGIN', externalRef: 'wecom-office',
          name: '企业微信办公套件（官方验证版）', releaseVersion: '1.1.0',
        },
        state: 'AUTHORIZED',
      }],
    }
    const start = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        capabilityExternalRef: 'wecom-office', status: 'authorizing',
        qrDataUrl: 'data:image/png;base64,aGVsbG8=',
      },
    })
    render(<AuthorizedCapabilitiesSection {...{
      ...props(vi.fn().mockResolvedValue(weComSnapshot)),
      skillSetup: {
        state: vi.fn().mockResolvedValue({
          ok: true,
          value: { capabilityExternalRef: 'wecom-office', status: 'unauthorized', version: '1.1.0' },
        }),
        start,
        cancel: vi.fn(),
        subscribe: vi.fn(() => () => {}),
      },
    }} />)

    fireEvent.click(await screen.findByRole('button', { name: '绑定企业微信' }))
    expect(await screen.findByAltText('企业微信授权二维码')).toBeTruthy()
    expect(start).toHaveBeenCalledWith('wecom-office')
  })

  it('does not present a QR binding action for the documentation-only WeCom Skill', async () => {
    const weComSkillSnapshot: AiHubMarketSnapshot = {
      available: true,
      evaluatedAt: '2026-08-18T10:00:00Z',
      items: [{
        capability: {
          id: 'skill-wecom', type: 'SKILL', externalRef: 'wecom-unified',
          name: '企业微信使用指南', releaseVersion: '1.1.0',
        },
        state: 'AUTHORIZED',
      }],
    }
    render(<AuthorizedCapabilitiesSection {...{
      ...props(vi.fn().mockResolvedValue(weComSkillSnapshot)),
      skillSetup: {
        state: vi.fn(), start: vi.fn(), cancel: vi.fn(), subscribe: vi.fn(() => () => {}),
      },
    }} />)

    expect(await screen.findByText('企业微信使用指南')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '绑定企业微信' })).toBeNull()
  })

  it('mounts the sidebar destination only with the live menu entitlement', async () => {
    const market = vi.fn().mockResolvedValue(snapshot)
    const authorized = {
      wide: true,
      entitlements: vi.fn().mockResolvedValue({ available: true, menus: ['PLUGIN_MARKET'] }),
      market,
      request: vi.fn(),
      t,
    } as unknown as EnterpriseMarketRootProps
    const view = render(<EnterpriseMarketRoot {...authorized} />)

    fireEvent.click(await screen.findByRole('button', { name: '企业能力市场' }))
    expect(await screen.findByRole('dialog', { name: '企业能力市场' })).toBeTruthy()
    expect(await screen.findByText('WorkBuddy')).toBeTruthy()
    view.unmount()

    render(<EnterpriseMarketRoot {...{
      ...authorized,
      entitlements: vi.fn().mockResolvedValue({ available: true, menus: [] }),
    }} />)
    await waitFor(() => { expect(screen.queryByRole('button', { name: '企业能力市场' })).toBeNull() })
  })

  it('renders the unified update as an icon-only Settings action', async () => {
    const openUpdate = vi.fn().mockResolvedValue({ ok: true, value: { status: 'scheduled', updates: [] } })
    const props = {
      wide: true,
      updates: {
        state: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            status: 'available',
            updates: [{
              type: 'CLIENT_PLUGIN',
              externalRef: 'agent-reach', name: 'Agent Reach',
              fromVersion: '1.5.0-dsh.1', toVersion: '1.5.0-dsh.2',
            }],
          },
        }),
        open: openUpdate,
        subscribe: vi.fn(() => () => {}),
      },
      t,
    } as unknown as ManagedUpdateActionProps
    const view = render(<ManagedUpdateAction {...props} />)

    const updateButton = await screen.findByRole('button', { name: '有可用升级' })
    expect(updateButton.textContent).toBe('')
    fireEvent.click(updateButton)
    expect(openUpdate).toHaveBeenCalledOnce()

    view.unmount()
    render(<ManagedUpdateAction {...{ ...props, wide: false }} />)
    expect(await screen.findByRole('button', { name: '有可用升级' })).toBeTruthy()
  })
})
