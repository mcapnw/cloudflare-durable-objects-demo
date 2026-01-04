import { FarmPlot } from './types'

export function updateFarm(farmPlots: FarmPlot[], now: number): boolean {
    let farmUpdated = false
    const GROWTH_TIME = 5 * 60 * 1000 // 5 minutes

    for (const plot of farmPlots) {
        if (plot.growthStage === 2 && plot.wateredAt > 0) {
            if (now - plot.wateredAt >= GROWTH_TIME) {
                plot.growthStage = 3 // READY
                farmUpdated = true
            }
        }
    }

    return farmUpdated
}
