export function lerp(start: number, end: number, t: number): number {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return end || 0
    return start + (end - start) * t
}

export function lerpAngle(start: number, end: number, t: number): number {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return end || 0
    let diff = end - start
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    return start + diff * t
}

export function getFaceName(filename: string) {
    const name = filename.replace('full_face_', '').replace('.png', '')
    return name.charAt(0).toUpperCase() + name.slice(1)
}
