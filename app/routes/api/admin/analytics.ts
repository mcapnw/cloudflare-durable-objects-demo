import { createRoute } from 'honox/factory'

const ADMIN_EMAIL = 'mcapnw@gmail.com'

export default createRoute(async (c) => {
    const user = c.get('user')
    if (!user || user.email !== ADMIN_EMAIL) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    const db = c.env.DB

    try {
        // Get total players from Users table
        const usersCount = await db.prepare(`SELECT COUNT(*) as count FROM Users`).first<{ count: number }>()

        // Get aggregate stats from PlayerSessions - handle if table is empty
        let aggregateResult = null
        try {
            aggregateResult = await db.prepare(`
                SELECT 
                    COUNT(DISTINCT user_id) as total_players,
                    COUNT(*) as total_sessions,
                    COALESCE(SUM(duration_seconds), 0) as total_playtime,
                    COALESCE(SUM(dragon_kills), 0) as total_dragon_kills,
                    COALESCE(SUM(deaths), 0) as total_deaths,
                    COALESCE(SUM(shots_fired), 0) as total_shots_fired,
                    COALESCE(SUM(coins_earned), 0) as total_coins_earned,
                    COALESCE(SUM(plants_planted), 0) as total_plants_planted,
                    COALESCE(SUM(plants_harvested), 0) as total_plants_harvested,
                    COALESCE(SUM(realm_joins), 0) as total_realm_joins
                FROM PlayerSessions
            `).first<{
                total_players: number
                total_sessions: number
                total_playtime: number
                total_dragon_kills: number
                total_deaths: number
                total_shots_fired: number
                total_coins_earned: number
                total_plants_planted: number
                total_plants_harvested: number
                total_realm_joins: number
            }>()
        } catch (e) {
            console.error('PlayerSessions query error:', e)
        }

        // Get per-player stats - handle if table is empty
        let playerStats: any[] = []
        try {
            const result = await db.prepare(`
                SELECT 
                    u.id as user_id,
                    u.first_name,
                    u.last_name,
                    u.picture,
                    COUNT(s.id) as total_sessions,
                    COALESCE(SUM(s.duration_seconds), 0) as total_playtime,
                    COALESCE(SUM(s.dragon_kills), 0) as total_dragon_kills,
                    COALESCE(SUM(s.deaths), 0) as total_deaths,
                    COALESCE(SUM(s.coins_earned), 0) as total_coins_earned
                FROM Users u
                LEFT JOIN PlayerSessions s ON u.id = s.user_id
                GROUP BY u.id
                ORDER BY total_dragon_kills DESC, total_coins_earned DESC
                LIMIT 50
            `).all()
            playerStats = result.results || []
        } catch (e) {
            console.error('Player stats query error:', e)
        }

        return c.json({
            totalPlayers: usersCount?.count || 0,
            totalSessions: aggregateResult?.total_sessions || 0,
            totalPlaytimeSeconds: aggregateResult?.total_playtime || 0,
            totalDragonKills: aggregateResult?.total_dragon_kills || 0,
            totalDeaths: aggregateResult?.total_deaths || 0,
            totalShotsFired: aggregateResult?.total_shots_fired || 0,
            totalCoinsEarned: aggregateResult?.total_coins_earned || 0,
            totalPlantsPlanted: aggregateResult?.total_plants_planted || 0,
            totalPlantsHarvested: aggregateResult?.total_plants_harvested || 0,
            totalRealmJoins: aggregateResult?.total_realm_joins || 0,
            playerStats
        })
    } catch (e) {
        console.error('Failed to fetch analytics:', e)
        return c.json({
            error: 'Failed to fetch analytics',
            totalPlayers: 0,
            totalSessions: 0,
            totalPlaytimeSeconds: 0,
            totalDragonKills: 0,
            totalDeaths: 0,
            totalShotsFired: 0,
            totalCoinsEarned: 0,
            totalPlayersPlanted: 0,
            totalPlantsHarvested: 0,
            totalRealmJoins: 0,
            playerStats: []
        })
    }
})
