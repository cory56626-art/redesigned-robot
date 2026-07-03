package net.marauder.state;

import net.minecraft.nbt.NbtCompound;

/**
 * Per-player persistent rivalry record. One instance exists for every player who
 * has ever been eligible for a Marauder encounter.
 */
public class PlayerProgress {

    /** Current stage that will spawn on the next eligible night (1..10). */
    public int stage = 1;

    /** Highest stage the player has actually defeated. */
    public int highestDefeated = 0;

    /** World day number of the last night an encounter was attempted (spawn lockout). */
    public long lastAttemptDay = -1;

    /** World day number of the last successful defeat. */
    public long lastDefeatDay = -1;

    /** Whether the Night 10 final duel has been completed. */
    public boolean finalComplete = false;

    /** Whether the player has unlocked voluntary rematches. */
    public boolean rematchUnlocked = false;

    /** Whether a rematch has been armed for the next eligible night. */
    public boolean rematchArmed = false;

    // --- Adaptive memory: coarse behavior counters from the last duel ---
    public int profShieldBlocks = 0;
    public int profRangedHits = 0;
    public int profHealCount = 0;
    public int profFleeTicks = 0;
    public int profCloseTicks = 0;
    public int profFastMelee = 0;
    public int profTrapUse = 0;

    public NbtCompound writeNbt() {
        NbtCompound nbt = new NbtCompound();
        nbt.putInt("stage", stage);
        nbt.putInt("highestDefeated", highestDefeated);
        nbt.putLong("lastAttemptDay", lastAttemptDay);
        nbt.putLong("lastDefeatDay", lastDefeatDay);
        nbt.putBoolean("finalComplete", finalComplete);
        nbt.putBoolean("rematchUnlocked", rematchUnlocked);
        nbt.putBoolean("rematchArmed", rematchArmed);
        nbt.putInt("pShield", profShieldBlocks);
        nbt.putInt("pRanged", profRangedHits);
        nbt.putInt("pHeal", profHealCount);
        nbt.putInt("pFlee", profFleeTicks);
        nbt.putInt("pClose", profCloseTicks);
        nbt.putInt("pFast", profFastMelee);
        nbt.putInt("pTrap", profTrapUse);
        return nbt;
    }

    public static PlayerProgress fromNbt(NbtCompound nbt) {
        PlayerProgress p = new PlayerProgress();
        p.stage = nbt.contains("stage") ? nbt.getInt("stage") : 1;
        p.highestDefeated = nbt.getInt("highestDefeated");
        p.lastAttemptDay = nbt.contains("lastAttemptDay") ? nbt.getLong("lastAttemptDay") : -1;
        p.lastDefeatDay = nbt.contains("lastDefeatDay") ? nbt.getLong("lastDefeatDay") : -1;
        p.finalComplete = nbt.getBoolean("finalComplete");
        p.rematchUnlocked = nbt.getBoolean("rematchUnlocked");
        p.rematchArmed = nbt.getBoolean("rematchArmed");
        p.profShieldBlocks = nbt.getInt("pShield");
        p.profRangedHits = nbt.getInt("pRanged");
        p.profHealCount = nbt.getInt("pHeal");
        p.profFleeTicks = nbt.getInt("pFlee");
        p.profCloseTicks = nbt.getInt("pClose");
        p.profFastMelee = nbt.getInt("pFast");
        p.profTrapUse = nbt.getInt("pTrap");
        return p;
    }

    public void resetProfile() {
        profShieldBlocks = 0;
        profRangedHits = 0;
        profHealCount = 0;
        profFleeTicks = 0;
        profCloseTicks = 0;
        profFastMelee = 0;
        profTrapUse = 0;
    }
}
