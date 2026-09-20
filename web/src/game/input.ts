export type InputAction = 'left' | 'right' | 'up' | 'down' | 'pause'

export type KeyBindings = Record<InputAction, string>

export const DEFAULT_BINDINGS: KeyBindings = {
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyW',
  down: 'KeyS',
  pause: 'Escape',
}

export function actionForCode(
  code: string,
  bindings: KeyBindings,
): InputAction | null {
  const entry = Object.entries(bindings).find(([, key]) => key === code)
  return (entry?.[0] as InputAction | undefined) ?? null
}

export function readableKey(code: string) {
  return code.replace('Key', '').replace('Arrow', 'Arrow ')
}
