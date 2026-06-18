export type Vec3 = { x: number; y: number; z: number }

export type MissileTrajectory = {
  start: Vec3
  controlA: Vec3
  controlB: Vec3
  end: Vec3
  duration: number
  wobble: number
}

export type MissileSample = {
  position: Vec3
  velocity: Vec3
  progress: number
  complete: boolean
}

const cubic = (a: number, b: number, c: number, d: number, t: number) => {
  const inverse = 1 - t
  return (
    inverse ** 3 * a +
    3 * inverse ** 2 * t * b +
    3 * inverse * t ** 2 * c +
    t ** 3 * d
  )
}

const pointOnTrajectory = (trajectory: MissileTrajectory, progress: number) => {
  const t = Math.min(1, Math.max(0, progress))
  const envelope = Math.sin(Math.PI * t)
  const lateral =
    Math.sin(t * Math.PI * (5 + trajectory.wobble)) *
    envelope *
    (1.4 + trajectory.wobble * 0.25)
  const vertical =
    Math.sin(t * Math.PI * (8 + trajectory.wobble)) * envelope * 0.55

  return {
    x:
      cubic(
        trajectory.start.x,
        trajectory.controlA.x,
        trajectory.controlB.x,
        trajectory.end.x,
        t,
      ) + lateral,
    y:
      cubic(
        trajectory.start.y,
        trajectory.controlA.y,
        trajectory.controlB.y,
        trajectory.end.y,
        t,
      ) + vertical,
    z: cubic(
      trajectory.start.z,
      trajectory.controlA.z,
      trajectory.controlB.z,
      trajectory.end.z,
      t,
    ),
  }
}

export function sampleMissileTrajectory(
  trajectory: MissileTrajectory,
  age: number,
): MissileSample {
  const progress = Math.min(1, Math.max(0, age / trajectory.duration))
  const position = pointOnTrajectory(trajectory, progress)
  const previous = pointOnTrajectory(trajectory, Math.max(0, progress - 0.01))

  return {
    position,
    velocity: {
      x: position.x - previous.x,
      y: position.y - previous.y,
      z: position.z - previous.z,
    },
    progress,
    complete: progress >= 1,
  }
}
