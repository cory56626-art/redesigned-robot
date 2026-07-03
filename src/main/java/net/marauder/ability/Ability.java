package net.marauder.ability;

/**
 * Declarative ability table. Every damaging ability defines a windup (telegraph),
 * an active window (when damage can land) and a recovery window (a punish gap),
 * plus a cooldown and a usable range band. The {@code MarauderEntity} reads these
 * fields to run readable, dodgeable attacks — no instant unavoidable damage.
 *
 * <p>Timings are in server ticks (20/sec).</p>
 */
public enum Ability {
    //          stage  cd   minR  maxR  windup active recovery
    LUNGE_CUT(       2, 60,  2.0f, 9.0f,  14,    8,    12),
    GUARD_BREAKER(   3, 90,  1.0f, 3.5f,  22,    6,    16),
    EARTHSPLITTER(   4, 110, 2.0f, 7.0f,  20,    8,    18),
    GRAVE_STEP(      4, 70,  0.0f, 6.0f,  8,     2,    8),
    CINDER_ARC(      5, 100, 1.0f, 5.0f,  18,    10,   14),
    BRAND_OF_PURSUIT(5, 160, 4.0f, 24.0f, 16,    4,    10),
    MOON_FLASH(      6, 120, 3.0f, 14.0f, 24,    6,    16),
    BLADE_BEAM(      7, 110, 4.0f, 20.0f, 22,    4,    14),
    RUNIC_SNARE(     7, 140, 3.0f, 16.0f, 18,    4,    12),
    ABYSSAL_CHAIN(   8, 120, 6.0f, 22.0f, 18,    6,    12),
    NIGHT_REND(      8, 130, 1.0f, 4.0f,  16,    14,   16),
    STARFALL_CLEAVE( 9, 150, 2.0f, 12.0f, 26,    8,    20),
    JUDGMENT_BEAM(  10, 160, 5.0f, 26.0f, 34,    6,    18),
    CATHEDRAL_BREAKER(10,180, 0.0f, 8.0f,  30,    10,   22),
    CROWNED_FLASH_STEP(10,110,3.0f, 16.0f, 20,    8,    14);

    public final int stageRequirement;
    public final int cooldown;
    public final float minRange;
    public final float maxRange;
    public final int windup;
    public final int active;
    public final int recovery;

    Ability(int stageRequirement, int cooldown, float minRange, float maxRange,
            int windup, int active, int recovery) {
        this.stageRequirement = stageRequirement;
        this.cooldown = cooldown;
        this.minRange = minRange;
        this.maxRange = maxRange;
        this.windup = windup;
        this.active = active;
        this.recovery = recovery;
    }

    public int totalDuration() {
        return windup + active + recovery;
    }

    public boolean inRange(double distance) {
        return distance >= minRange && distance <= maxRange;
    }
}
