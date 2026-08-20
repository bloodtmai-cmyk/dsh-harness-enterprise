/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

type PermissionPresentationKey =
  | 'preset.readOnly'
  | 'preset.workspaceWrite'
  | 'preset.fullAccess'
  | 'preset.custom'
  | 'preset.description.readOnly'
  | 'preset.description.workspaceWrite'
  | 'preset.description.fullAccess'

type PermissionTranslate = (key: PermissionPresentationKey) => string

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @returns the Full access product label or the conventional display name.
 */
export function displayPermissionPreset(value: string, name: string, t?: PermissionTranslate): string {
  if (t !== undefined) {
    switch (value) {
      case 'read-only': return t('preset.readOnly')
      case 'workspace-write': return t('preset.workspaceWrite')
      case FULL_ACCESS_PRESET: return t('preset.fullAccess')
      case 'custom': return t('preset.custom')
    }
  }
  return value === FULL_ACCESS_PRESET ? 'Full access' : displayPresetName(name)
}

/** Localize a built-in preset description while preserving deployment-defined copy. */
export function displayPermissionDescription(
  value: string,
  description: string | undefined,
  t: PermissionTranslate,
): string | undefined {
  switch (value) {
    case 'read-only': return t('preset.description.readOnly')
    case 'workspace-write': return t('preset.description.workspaceWrite')
    case FULL_ACCESS_PRESET: return t('preset.description.fullAccess')
    default: return description
  }
}
