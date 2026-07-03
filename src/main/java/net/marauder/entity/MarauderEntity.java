package net.marauder.entity;

import net.marauder.ability.Ability;
import net.marauder.duel.DuelManager;
import net.marauder.registry.ModItems;
import net.marauder.state.MarauderState;
import net.marauder.state.PlayerProgress;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.ai.goal.LookAroundGoal;
import net.minecraft.entity.ai.goal.LookAtEntityGoal;
import net.minecraft.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.entity.ai.goal.SwimGoal;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.boss.BossBar;
import net.minecraft.entity.boss.ServerBossBar;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The Marauder: a persistent, player-specific cursed knight that stalks, ambushes
 * and duels a single target across ten escalating nights.
 *
 * <p>All authoritative behavior runs server-side inside {@link #serverTick()}, a
 * deterministic state machine over {@link Behavior}. Every damaging ability runs a
 * telegraph → active → recovery cycle so nothing is instant or unavoidable.</p>
 */
public class MarauderEntity extends HostileEntity {

    private static final TrackedData<Integer> STAGE =
            DataTracker.registerData(MarauderEntity.class, TrackedDataHandlerRegistry.INTEGER);
    private static final TrackedData<Integer> STATE =
            DataTracker.registerData(MarauderEntity.class, TrackedDataHandlerRegistry.INTEGER);
    private static final TrackedData<Integer> TELEGRAPH =
            DataTracker.registerData(MarauderEntity.class, TrackedDataHandlerRegistry.INTEGER);

    // Trigger and escape distances (blocks).
    private static final double CHALLENGE_RADIUS = 11.0;
    private static final double STALK_STANDOFF = 13.0;
    private static final double REPOSITION_DISTANCE = 48.0;
    private static final double END_DISTANCE = 80.0;

    private Behavior behavior = Behavior.IDLE_DORMANT;
    private UUID targetPlayerUuid;
    private int ticksInState;
    private BlockPos ambushPos;

    private Ability currentAbility;
    private int abilityTick;
    private final Map<Ability, Integer> cooldowns = new EnumMap<>(Ability.class);
    private int globalAbilityCooldown;

    private ServerBossBar bossBar;
    private boolean attemptRecorded;
    private long lastTargetDamageTick = Long.MIN_VALUE;
    private int noPathTicks;
    private int finalPhase = 1;
    private boolean arenaCreated;
    private boolean defeatHandled;

    // Adaptive biases loaded from the previous defeat profile (0 = neutral).
    private int biasShield;
    private int biasRanged;
    private int biasHeal;
    private int biasFlee;
    private int biasTrap;

    public MarauderEntity(EntityType<? extends MarauderEntity> type, World world) {
        super(type, world);
        this.setPersistent();
        this.experiencePoints = 12;
        this.setEquipmentDropChance(EquipmentSlot.MAINHAND, 0f);
        this.setEquipmentDropChance(EquipmentSlot.HEAD, 0f);
        this.setEquipmentDropChance(EquipmentSlot.CHEST, 0f);
        this.setEquipmentDropChance(EquipmentSlot.LEGS, 0f);
        this.setEquipmentDropChance(EquipmentSlot.FEET, 0f);
    }

    public static DefaultAttributeContainer.Builder createMarauderAttributes() {
        return HostileEntity.createHostileAttributes()
                .add(EntityAttributes.GENERIC_MAX_HEALTH, 20.0)
                .add(EntityAttributes.GENERIC_MOVEMENT_SPEED, 0.30)
                .add(EntityAttributes.GENERIC_ATTACK_DAMAGE, 4.0)
                .add(EntityAttributes.GENERIC_ARMOR, 2.0)
                .add(EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, 0.4)
                .add(EntityAttributes.GENERIC_ATTACK_KNOCKBACK, 0.5)
                .add(EntityAttributes.GENERIC_FOLLOW_RANGE, 64.0);
    }

    @Override
    protected void initGoals() {
        this.goalSelector.add(0, new SwimGoal(this));
        this.goalSelector.add(4, new MeleeAttackGoal(this, 1.15, true));
        this.goalSelector.add(7, new LookAtEntityGoal(this, PlayerEntity.class, 24.0f));
        this.goalSelector.add(8, new LookAroundGoal(this));
    }

    @Override
    protected void initDataTracker() {
        super.initDataTracker();
        this.dataTracker.startTracking(STAGE, 1);
        this.dataTracker.startTracking(STATE, Behavior.IDLE_DORMANT.ordinal());
        this.dataTracker.startTracking(TELEGRAPH, 0);
    }

    // ----------------------------------------------------------------- setup

    public int getStage() {
        return this.dataTracker.get(STAGE);
    }

    public Behavior getBehaviorState() {
        return Behavior.byId(this.dataTracker.get(STATE));
    }

    /** True while an ability is winding up — the client uses this to draw charge particles. */
    public boolean isTelegraphing() {
        return this.dataTracker.get(TELEGRAPH) > 0;
    }

    public void initFromStage(int stage, ServerPlayerEntity target) {
        stage = MarauderStages.clamp(stage);
        this.dataTracker.set(STAGE, stage);
        this.targetPlayerUuid = target.getUuid();

        applyStageAttributes(stage);
        applyStageEquipment(stage);
        loadAdaptiveProfile(target);

        this.setHealth(this.getMaxHealth());
        if (MarauderStages.isFinal(stage)) {
            setState(Behavior.FINAL_WAIT);
        } else {
            setState(Behavior.STALKING);
        }
    }

    private void applyStageAttributes(int stage) {
        setAttr(EntityAttributes.GENERIC_MAX_HEALTH, MarauderStages.health(stage));
        setAttr(EntityAttributes.GENERIC_ARMOR, MarauderStages.armor(stage));
        setAttr(EntityAttributes.GENERIC_ATTACK_DAMAGE, MarauderStages.damage(stage));
        setAttr(EntityAttributes.GENERIC_MOVEMENT_SPEED, MarauderStages.speed(stage));
        setAttr(EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, MarauderStages.knockbackResistance(stage));
        this.experiencePoints = MarauderStages.experience(stage);
    }

    private void setAttr(net.minecraft.entity.attribute.EntityAttribute attr, double value) {
        var inst = this.getAttributeInstance(attr);
        if (inst != null) {
            inst.setBaseValue(value);
        }
    }

    private void applyStageEquipment(int stage) {
        // Held blade scales with stage; armor gives the silhouette its evolving look.
        ItemStack sword = new ItemStack(stage >= 4 ? Items.NETHERITE_SWORD
                : stage >= 2 ? Items.IRON_SWORD : Items.STONE_SWORD);
        this.equipStack(EquipmentSlot.MAINHAND, sword);

        if (stage >= 2) {
            this.equipStack(EquipmentSlot.HEAD, new ItemStack(stage >= 6 ? Items.NETHERITE_HELMET : Items.IRON_HELMET));
        }
        if (stage >= 3) {
            this.equipStack(EquipmentSlot.CHEST, new ItemStack(stage >= 6 ? Items.NETHERITE_CHESTPLATE : Items.IRON_CHESTPLATE));
        }
        if (stage >= 4) {
            this.equipStack(EquipmentSlot.LEGS, new ItemStack(stage >= 7 ? Items.NETHERITE_LEGGINGS : Items.IRON_LEGGINGS));
        }
        if (stage >= 5) {
            this.equipStack(EquipmentSlot.FEET, new ItemStack(stage >= 8 ? Items.NETHERITE_BOOTS : Items.IRON_BOOTS));
        }
    }

    private void loadAdaptiveProfile(ServerPlayerEntity target) {
        if (this.getServer() == null) {
            return;
        }
        PlayerProgress p = MarauderState.get(this.getServer()).peek(target.getUuid());
        if (p == null) {
            return;
        }
        biasShield = p.profShieldBlocks;
        biasRanged = p.profRangedHits;
        biasHeal = p.profHealCount;
        biasFlee = p.profFleeTicks;
        biasTrap = p.profTrapUse;
    }

    public void setAmbushPos(BlockPos pos) {
        this.ambushPos = pos;
    }

    public void setTargetPlayer(UUID uuid) {
        this.targetPlayerUuid = uuid;
    }

    private void setState(Behavior next) {
        this.behavior = next;
        this.dataTracker.set(STATE, next.ordinal());
        this.ticksInState = 0;
    }

    // ----------------------------------------------------------------- tick

    @Override
    public void tick() {
        super.tick();
        if (this.getWorld().isClient) {
            clientParticles();
            return;
        }
        serverTick();
    }

    private void serverTick() {
        ticksInState++;
        tickCooldowns();

        ServerPlayerEntity target = resolveTarget();

        switch (behavior) {
            case STALKING -> tickStalking(target);
            case CHALLENGE -> tickChallenge(target);
            case DUELING, FINAL_DUEL -> tickDueling(target);
            case REPOSITIONING -> tickReposition(target);
            case FINAL_WAIT -> tickFinalWait(target);
            case RETREATING -> tickRetreating();
            default -> {
                // IDLE/DEFEATED: nothing to drive.
            }
        }

        if (bossBar != null) {
            bossBar.setPercent(MathHelper.clamp(this.getHealth() / this.getMaxHealth(), 0f, 1f));
        }
    }

    private ServerPlayerEntity resolveTarget() {
        if (targetPlayerUuid == null) {
            return null;
        }
        PlayerEntity p = this.getWorld().getPlayerByUuid(targetPlayerUuid);
        return (p instanceof ServerPlayerEntity sp) ? sp : null;
    }

    private boolean isNightNow() {
        long t = this.getWorld().getTimeOfDay() % 24000L;
        return t >= 13000L && t < 23000L;
    }

    // ---- STALKING -----------------------------------------------------

    private void tickStalking(ServerPlayerEntity target) {
        if (target == null || !target.isAlive() || target.isCreative() || target.isSpectator()
                || target.getWorld() != this.getWorld()) {
            beginRetreat();
            return;
        }
        if (!isNightNow()) {
            beginRetreat();
            return;
        }
        this.setTarget(null);
        this.getLookControl().lookAt(target, 30f, 30f);

        double dist = this.distanceTo(target);

        // Hold near the ambush point; drift toward the player's vicinity but keep a standoff gap.
        BlockPos anchor = ambushPos != null ? ambushPos : target.getBlockPos();
        if (this.squaredDistanceTo(Vec3d.ofCenter(anchor)) > 4.0 && dist > STALK_STANDOFF) {
            this.getNavigation().startMovingTo(anchor.getX() + 0.5, anchor.getY(), anchor.getZ() + 0.5, 0.9);
        } else if (dist < STALK_STANDOFF - 3) {
            this.getNavigation().stop();
        }

        if (dist <= CHALLENGE_RADIUS) {
            setState(Behavior.CHALLENGE);
        }
    }

    // ---- CHALLENGE ----------------------------------------------------

    private void tickChallenge(ServerPlayerEntity target) {
        if (target == null) {
            beginRetreat();
            return;
        }
        if (ticksInState == 1) {
            recordAttempt(target);
            World w = this.getWorld();
            w.playSound(null, this.getX(), this.getY(), this.getZ(),
                    SoundEvents.ENTITY_ENDER_DRAGON_GROWL, SoundCategory.HOSTILE, 0.8f, 0.5f);
            w.playSound(null, this.getX(), this.getY(), this.getZ(),
                    SoundEvents.ENTITY_ELDER_GUARDIAN_CURSE, SoundCategory.HOSTILE, 0.7f, 0.7f);
            target.sendMessage(Text.literal("The Marauder has found you.").formatted(Formatting.DARK_RED), false);
            spawnRing(this.getPos(), 1.6, ParticleTypes.LARGE_SMOKE, 40);
            repelBystanderMobs();
        }
        this.getLookControl().lookAt(target, 30f, 30f);
        this.getNavigation().stop();

        if (ticksInState >= 40) {
            startDuel(target);
        }
    }

    private void startDuel(ServerPlayerEntity target) {
        int stage = getStage();
        setState(MarauderStages.isFinal(stage) ? Behavior.FINAL_DUEL : Behavior.DUELING);
        this.setTarget(target);
        globalAbilityCooldown = 40;

        if (MarauderStages.hasBossBar(stage)) {
            bossBar = new ServerBossBar(
                    Text.literal(MarauderStages.title(stage)).formatted(Formatting.DARK_RED),
                    stage >= 9 ? BossBar.Color.PURPLE : BossBar.Color.RED,
                    BossBar.Style.PROGRESS);
            bossBar.setDarkenSky(stage >= 10);
            addBossBarPlayer(target);
        }
    }

    // ---- DUELING ------------------------------------------------------

    private void tickDueling(ServerPlayerEntity target) {
        if (target == null) {
            // Logged out or left dimension: pause safely, no stage advancement.
            beginRetreat();
            return;
        }
        if (!target.isAlive()) {
            // Handled by the death event, but guard anyway.
            beginRetreat();
            return;
        }

        double dist = this.distanceTo(target);
        if (dist > END_DISTANCE || target.getWorld() != this.getWorld()) {
            endDuelNoAdvance(target, "The Marauder loses your trail and melts into the dark.");
            return;
        }

        this.setTarget(target);
        collectBehavior(target, dist);
        updateFinalPhase();

        // Reposition if the player runs or if we cannot path for a while.
        if (dist > REPOSITION_DISTANCE) {
            setState(Behavior.REPOSITIONING);
            return;
        }
        if (this.getNavigation().isIdle() && dist > 3.5) {
            noPathTicks++;
            if (noPathTicks > 60) {
                noPathTicks = 0;
                setState(Behavior.REPOSITIONING);
                return;
            }
        } else {
            noPathTicks = 0;
        }

        tickAbilities(target, dist);
    }

    private void tickAbilities(ServerPlayerEntity target, double dist) {
        if (currentAbility != null) {
            runActiveAbility(target);
            return;
        }
        if (globalAbilityCooldown > 0) {
            globalAbilityCooldown--;
            return;
        }
        Ability chosen = chooseAbility(dist);
        if (chosen != null) {
            beginAbility(chosen, target);
        }
    }

    private Ability chooseAbility(double dist) {
        int stage = getStage();
        List<Ability> pool = new ArrayList<>();
        List<Integer> weights = new ArrayList<>();
        for (Ability a : Ability.values()) {
            if (a.stageRequirement > stage) continue;
            if (cooldowns.getOrDefault(a, 0) > 0) continue;
            if (!a.inRange(dist)) continue;
            int w = 10 + adaptiveWeight(a);
            pool.add(a);
            weights.add(Math.max(1, w));
        }
        if (pool.isEmpty()) {
            return null;
        }
        int total = weights.stream().mapToInt(Integer::intValue).sum();
        int roll = this.random.nextInt(total);
        for (int i = 0; i < pool.size(); i++) {
            roll -= weights.get(i);
            if (roll < 0) {
                return pool.get(i);
            }
        }
        return pool.get(pool.size() - 1);
    }

    /** Subtle bias based on the previous defeat profile — personal, not unfair. */
    private int adaptiveWeight(Ability a) {
        switch (a) {
            case GUARD_BREAKER:
                return biasShield > 6 ? 12 : 0;
            case MOON_FLASH:
            case CROWNED_FLASH_STEP:
                return biasRanged > 6 ? 8 : 0;
            case NIGHT_REND:
                return 0; // riposte-like punishment handled in damage()
            case BRAND_OF_PURSUIT:
            case ABYSSAL_CHAIN:
                return biasFlee > 40 ? 12 : 0;
            case GRAVE_STEP:
                return biasTrap > 3 ? 10 : 0;
            default:
                return 0;
        }
    }

    private void beginAbility(Ability a, ServerPlayerEntity target) {
        currentAbility = a;
        abilityTick = 0;
        this.dataTracker.set(TELEGRAPH, a.windup);
        this.getLookControl().lookAt(target, 30f, 30f);
        playTelegraphStart(a);
    }

    private void runActiveAbility(ServerPlayerEntity target) {
        Ability a = currentAbility;
        abilityTick++;

        if (abilityTick <= a.windup) {
            this.dataTracker.set(TELEGRAPH, a.windup - abilityTick);
            telegraphParticles(a, target);
            // Face the target through the windup so the attack is readable.
            if (target != null) {
                this.getLookControl().lookAt(target, 30f, 30f);
            }
            return;
        }

        int activeTick = abilityTick - a.windup;
        if (activeTick <= a.active) {
            applyAbilityEffect(a, target, activeTick);
            return;
        }

        if (abilityTick >= a.totalDuration()) {
            // Recovery finished — go on cooldown, leaving a punish window already elapsed.
            cooldowns.put(a, a.cooldown);
            globalAbilityCooldown = 25 + this.random.nextInt(20);
            currentAbility = null;
            this.dataTracker.set(TELEGRAPH, 0);
        }
    }

    // ---- REPOSITION / FINAL WAIT / RETREAT ----------------------------

    private void tickReposition(ServerPlayerEntity target) {
        if (target == null) {
            beginRetreat();
            return;
        }
        double dist = this.distanceTo(target);
        if (dist > END_DISTANCE) {
            endDuelNoAdvance(target, "The Marauder loses your trail and melts into the dark.");
            return;
        }
        // One flash-step toward a fair point near the player.
        Vec3d behind = target.getPos().subtract(target.getRotationVec(1.0f).multiply(4.0));
        if (tryTeleportNear(behind) || tryTeleportNear(target.getPos().add(4, 0, 0))) {
            spawnRing(this.getPos(), 1.2, ParticleTypes.SMOKE, 24);
            this.getWorld().playSound(null, this.getX(), this.getY(), this.getZ(),
                    SoundEvents.ENTITY_ENDERMAN_TELEPORT, SoundCategory.HOSTILE, 0.8f, 0.7f);
        }
        setState(getStage() >= MarauderStages.MAX_STAGE ? Behavior.FINAL_DUEL : Behavior.DUELING);
    }

    private void tickFinalWait(ServerPlayerEntity target) {
        if (!isNightNow()) {
            // The challenge is a night ritual; withdraw cleanly at dawn and return next night.
            beginRetreat();
            return;
        }
        if (target == null) {
            // Wait patiently; do not retreat just because the owner stepped away briefly.
            return;
        }
        this.getLookControl().lookAt(target, 30f, 30f);
        this.getNavigation().stop();
        this.setTarget(null);
        if (this.age % 40 == 0) {
            spawnRing(this.getPos(), 1.0, ParticleTypes.SOUL_FIRE_FLAME, 6);
        }
        if (this.distanceTo(target) <= CHALLENGE_RADIUS) {
            setState(Behavior.CHALLENGE);
        }
    }

    private void tickRetreating() {
        if (ticksInState == 1 && this.getWorld() instanceof ServerWorld sw) {
            sw.spawnParticles(ParticleTypes.LARGE_SMOKE, this.getX(), this.getBodyY(0.5), this.getZ(),
                    60, 0.4, 0.6, 0.4, 0.02);
            sw.spawnParticles(ParticleTypes.ASH, this.getX(), this.getBodyY(0.6), this.getZ(),
                    40, 0.5, 0.8, 0.5, 0.01);
            this.getWorld().playSound(null, this.getX(), this.getY(), this.getZ(),
                    SoundEvents.ENTITY_ENDERMAN_TELEPORT, SoundCategory.HOSTILE, 0.9f, 0.5f);
        }
        if (ticksInState >= 12) {
            cleanupAndDiscard();
        }
    }

    private void beginRetreat() {
        removeBossBar();
        if (targetPlayerUuid != null) {
            DuelManager.clear(targetPlayerUuid, this);
        }
        setState(Behavior.RETREATING);
    }

    private void endDuelNoAdvance(ServerPlayerEntity target, String message) {
        if (target != null && message != null) {
            target.sendMessage(Text.literal(message).formatted(Formatting.GRAY), true);
        }
        beginRetreat();
    }

    private void cleanupAndDiscard() {
        removeBossBar();
        if (targetPlayerUuid != null) {
            DuelManager.clear(targetPlayerUuid, this);
        }
        this.discard();
    }

    // ----------------------------------------------------------------- combat memory / anti-cheese

    private void collectBehavior(ServerPlayerEntity target, double dist) {
        if (this.age % 5 != 0) {
            return;
        }
        PlayerProgress p = progress(target);
        if (p == null) {
            return;
        }
        if (target.isBlocking()) p.profShieldBlocks++;
        if (dist > 12) p.profFleeTicks += 5;
        if (dist < 4) p.profCloseTicks += 5;
        if (target.isUsingItem() && target.getActiveItem().isFood()) p.profHealCount++;
        ItemStack main = target.getMainHandStack();
        if (main.getItem() == Items.BOW || main.getItem() == Items.CROSSBOW || main.getItem() == Items.TRIDENT) {
            p.profRangedHits++;
        }
    }

    private PlayerProgress progress(ServerPlayerEntity target) {
        if (this.getServer() == null) {
            return null;
        }
        return MarauderState.get(this.getServer()).getOrCreate(target.getUuid());
    }

    private void recordAttempt(ServerPlayerEntity target) {
        if (attemptRecorded || MarauderStages.isFinal(getStage())) {
            return;
        }
        PlayerProgress p = progress(target);
        if (p != null) {
            p.lastAttemptDay = this.getWorld().getTimeOfDay() / 24000L;
            MarauderState.get(this.getServer()).markDirty();
        }
        attemptRecorded = true;
    }

    @Override
    public boolean damage(DamageSource source, float amount) {
        // Anti-trap: shrug off cheese damage sources entirely.
        if (source.isOf(net.minecraft.entity.damage.DamageTypes.IN_WALL)
                || source.isOf(net.minecraft.entity.damage.DamageTypes.CRAMMING)
                || source.isOf(net.minecraft.entity.damage.DamageTypes.DROWN)
                || source.isOf(net.minecraft.entity.damage.DamageTypes.IN_FIRE)
                || source.isOf(net.minecraft.entity.damage.DamageTypes.ON_FIRE)) {
            return false;
        }

        if (source.getAttacker() instanceof PlayerEntity player) {
            boolean isTarget = player.getUuid().equals(targetPlayerUuid);
            if (!isTarget) {
                // Non-target players may help defensively but cannot carry the duel.
                amount *= 0.10f;
            } else {
                lastTargetDamageTick = this.getWorld().getTime();
                maybeRiposte(player);
            }
        }
        return super.damage(source, amount);
    }

    /** Punish greedy melee spam with a quick, telegraphed counter after a parry spark. */
    private void maybeRiposte(PlayerEntity player) {
        if (getStage() < 3 || currentAbility != null || this.random.nextInt(4) != 0) {
            return;
        }
        if (this.getWorld() instanceof ServerWorld sw) {
            sw.spawnParticles(ParticleTypes.CRIT, this.getX(), this.getBodyY(1.0), this.getZ(), 12, 0.2, 0.2, 0.2, 0.1);
            this.getWorld().playSound(null, this.getX(), this.getY(), this.getZ(),
                    SoundEvents.ITEM_SHIELD_BLOCK, SoundCategory.HOSTILE, 0.8f, 1.4f);
        }
        if (this.distanceTo(player) < 3.5f && player instanceof ServerPlayerEntity sp) {
            dealDamage(sp, 0.6f);
        }
    }

    @Override
    public boolean isPushable() {
        // Resist being shoved into cages / off ledges during the duel.
        return !getBehaviorState().isCombat();
    }

    @Override
    public boolean isImmuneToExplosion() {
        return getStage() >= 8;
    }

    @Override
    public boolean canImmediatelyDespawn(double distanceSquared) {
        return false;
    }

    @Override
    public boolean cannotDespawn() {
        return true;
    }

    // ----------------------------------------------------------------- death / rewards

    @Override
    public void onDeath(DamageSource damageSource) {
        if (!this.getWorld().isClient && !defeatHandled) {
            defeatHandled = true;
            handleDefeat();
        }
        super.onDeath(damageSource);
    }

    private void handleDefeat() {
        removeBossBar();
        ServerPlayerEntity target = resolveTarget();
        if (targetPlayerUuid != null) {
            DuelManager.clear(targetPlayerUuid, this);
        }
        if (this.getWorld() instanceof ServerWorld sw) {
            sw.spawnParticles(ParticleTypes.SOUL, this.getX(), this.getBodyY(0.6), this.getZ(), 60, 0.4, 0.7, 0.4, 0.02);
            sw.spawnParticles(ParticleTypes.SOUL_FIRE_FLAME, this.getX(), this.getBodyY(0.6), this.getZ(), 30, 0.3, 0.6, 0.3, 0.02);
        }
        if (target == null || this.getServer() == null) {
            return;
        }

        // Anti-cheese: only advance if the owning player meaningfully participated.
        boolean valid = this.getWorld().getTime() - lastTargetDamageTick <= 200;

        int stage = getStage();
        dropStageRewards(stage);

        MarauderState state = MarauderState.get(this.getServer());
        PlayerProgress p = state.getOrCreate(target.getUuid());

        if (valid) {
            p.highestDefeated = Math.max(p.highestDefeated, stage);
            p.lastDefeatDay = this.getWorld().getTimeOfDay() / 24000L;
            // Persist the freshly gathered behavior profile for next time.
            if (MarauderStages.isFinal(stage)) {
                p.finalComplete = true;
                p.rematchArmed = false;
                target.sendMessage(Text.literal("The Marauder Ascendant falls. The ten-night rivalry is over.")
                        .formatted(Formatting.GOLD), false);
                target.sendMessage(Text.literal("An Ashen Remnant remains — should you ever wish to face him again.")
                        .formatted(Formatting.DARK_GRAY), false);
            } else {
                p.stage = MarauderStages.clamp(stage + 1);
                target.sendMessage(Text.literal("The Marauder falls — but he will return, stronger.")
                        .formatted(Formatting.RED), false);
            }
            state.markDirty();
        } else {
            target.sendMessage(Text.literal("The Marauder was slain by another hand. Your rivalry is unchanged.")
                    .formatted(Formatting.GRAY), true);
        }
    }

    private void dropStageRewards(int stage) {
        this.dropStack(new ItemStack(ModItems.DARK_SCRAP, 1 + this.random.nextInt(2)));
        if (stage >= 3) this.dropStack(new ItemStack(ModItems.BLACKSTEEL_FRAGMENT, 1 + this.random.nextInt(2)));
        if (stage >= 5) this.dropStack(new ItemStack(ModItems.ASHEN_SHARD));
        if (stage >= 6) this.dropStack(new ItemStack(ModItems.MOON_SHARD));
        if (stage >= 7) this.dropStack(new ItemStack(ModItems.RUNE_FRAGMENT));
        if (stage >= 8) this.dropStack(new ItemStack(ModItems.ABYSS_FRAGMENT));
        if (stage >= 9) this.dropStack(new ItemStack(ModItems.UNBROKEN_CORE));
        if (MarauderStages.isFinal(stage)) {
            this.dropStack(new ItemStack(ModItems.BLACKSTEEL_BLADE));
            this.dropStack(new ItemStack(ModItems.MARAUDER_TROPHY));
            this.dropStack(new ItemStack(ModItems.ASHEN_REMNANT));
        }
    }

    // ----------------------------------------------------------------- final-phase logic

    private void updateFinalPhase() {
        if (!MarauderStages.isFinal(getStage())) {
            return;
        }
        float frac = this.getHealth() / this.getMaxHealth();
        int newPhase = frac > 0.66f ? 1 : frac > 0.33f ? 2 : 3;
        if (newPhase != finalPhase) {
            finalPhase = newPhase;
            if (this.getWorld() instanceof ServerWorld sw) {
                sw.spawnParticles(ParticleTypes.FLASH, this.getX(), this.getBodyY(1.0), this.getZ(), 1, 0, 0, 0, 0);
                sw.spawnParticles(ParticleTypes.END_ROD, this.getX(), this.getBodyY(1.0), this.getZ(), 40, 0.5, 0.8, 0.5, 0.05);
            }
            this.getWorld().playSound(null, this.getX(), this.getY(), this.getZ(),
                    SoundEvents.ENTITY_WITHER_SPAWN, SoundCategory.HOSTILE, 0.6f, 1.4f);
            ServerPlayerEntity t = resolveTarget();
            if (t != null) {
                t.sendMessage(Text.literal("The Marauder Ascendant enters phase " + finalPhase + ".")
                        .formatted(Formatting.LIGHT_PURPLE), true);
            }
        }
    }

    // ----------------------------------------------------------------- ability effects

    private float attackBase() {
        return (float) this.getAttributeValue(EntityAttributes.GENERIC_ATTACK_DAMAGE);
    }

    private void dealDamage(ServerPlayerEntity player, float multiplier) {
        player.damage(this.getWorld().getDamageSources().mobAttack(this), attackBase() * multiplier);
    }

    private void playTelegraphStart(Ability a) {
        World w = this.getWorld();
        switch (a) {
            case GUARD_BREAKER, EARTHSPLITTER, CATHEDRAL_BREAKER, STARFALL_CLEAVE ->
                    w.playSound(null, getX(), getY(), getZ(), SoundEvents.ENTITY_RAVAGER_ROAR, SoundCategory.HOSTILE, 0.7f, 0.6f);
            case JUDGMENT_BEAM, BLADE_BEAM ->
                    w.playSound(null, getX(), getY(), getZ(), SoundEvents.BLOCK_BEACON_ACTIVATE, SoundCategory.HOSTILE, 0.8f, 1.6f);
            case MOON_FLASH, CROWNED_FLASH_STEP ->
                    w.playSound(null, getX(), getY(), getZ(), SoundEvents.BLOCK_AMETHYST_BLOCK_CHIME, SoundCategory.HOSTILE, 1.0f, 0.8f);
            default ->
                    w.playSound(null, getX(), getY(), getZ(), SoundEvents.ENTITY_ZOMBIE_ATTACK_IRON_DOOR, SoundCategory.HOSTILE, 0.5f, 0.7f);
        }
    }

    private void telegraphParticles(Ability a, ServerPlayerEntity target) {
        if (!(this.getWorld() instanceof ServerWorld sw)) {
            return;
        }
        if (this.age % 2 != 0) {
            return;
        }
        Vec3d head = this.getPos().add(0, 1.4, 0);
        switch (a) {
            case JUDGMENT_BEAM, BLADE_BEAM -> {
                Vec3d dir = target != null ? target.getPos().subtract(this.getPos()).normalize() : this.getRotationVec(1f);
                for (int i = 1; i < 6; i++) {
                    Vec3d p = head.add(dir.multiply(i));
                    sw.spawnParticles(ParticleTypes.END_ROD, p.x, p.y, p.z, 1, 0.02, 0.02, 0.02, 0.0);
                }
            }
            case EARTHSPLITTER, CATHEDRAL_BREAKER, STARFALL_CLEAVE ->
                    sw.spawnParticles(ParticleTypes.CRIT, this.getX(), this.getY() + 0.1, this.getZ(), 8, 0.6, 0.05, 0.6, 0.02);
            case GUARD_BREAKER ->
                    sw.spawnParticles(ParticleTypes.ANGRY_VILLAGER, head.x, head.y + 0.6, head.z, 2, 0.1, 0.1, 0.1, 0.0);
            case CINDER_ARC ->
                    sw.spawnParticles(ParticleTypes.FLAME, head.x, head.y, head.z, 4, 0.4, 0.2, 0.4, 0.01);
            case RUNIC_SNARE ->
                    sw.spawnParticles(ParticleTypes.WITCH, head.x, head.y, head.z, 4, 0.3, 0.3, 0.3, 0.0);
            default ->
                    sw.spawnParticles(ParticleTypes.SMOKE, head.x, head.y, head.z, 2, 0.2, 0.2, 0.2, 0.01);
        }
    }

    private void applyAbilityEffect(Ability a, ServerPlayerEntity target, int activeTick) {
        if (target == null) {
            return;
        }
        switch (a) {
            case LUNGE_CUT -> effectLunge(target, activeTick);
            case GUARD_BREAKER -> { if (activeTick == 1) effectGuardBreaker(target); }
            case EARTHSPLITTER -> { if (activeTick == 1) effectShockCone(target, 7.0, 1.1f); }
            case GRAVE_STEP -> { if (activeTick == 1) effectGraveStep(target); }
            case CINDER_ARC -> { if (activeTick == 1) effectCinderArc(target); }
            case BRAND_OF_PURSUIT -> { if (activeTick == 1) effectBrand(target); }
            case MOON_FLASH -> { if (activeTick == 1) effectDashThrough(target, 1.4f); }
            case BLADE_BEAM -> { if (activeTick == 1) effectBeam(target, 20.0, 1.1f); }
            case RUNIC_SNARE -> { if (activeTick == 1) effectSnare(target); }
            case ABYSSAL_CHAIN -> { if (activeTick == 1) effectChain(target); }
            case NIGHT_REND -> effectNightRend(target, activeTick);
            case STARFALL_CLEAVE -> effectStarfall(target, activeTick);
            case JUDGMENT_BEAM -> { if (activeTick == 1) effectBeam(target, 26.0, 1.6f); }
            case CATHEDRAL_BREAKER -> { if (activeTick == 1) effectShockRing(target, 8.0, 1.6f); }
            case CROWNED_FLASH_STEP -> effectCrownedFlash(target, activeTick);
        }
    }

    private void effectLunge(ServerPlayerEntity target, int activeTick) {
        if (activeTick == 1) {
            Vec3d dir = target.getPos().subtract(this.getPos()).normalize();
            this.setVelocity(dir.x * 1.1, 0.15, dir.z * 1.1);
            this.velocityModified = true;
        }
        if (this.distanceTo(target) < 3.0) {
            dealDamage(target, 1.0f);
            target.takeKnockback(0.4, this.getX() - target.getX(), this.getZ() - target.getZ());
            currentAbility = null; // consumed on contact
            this.dataTracker.set(TELEGRAPH, 0);
            cooldowns.put(Ability.LUNGE_CUT, Ability.LUNGE_CUT.cooldown);
            globalAbilityCooldown = 30;
        }
    }

    private void effectGuardBreaker(ServerPlayerEntity target) {
        if (this.distanceTo(target) > 4.0) {
            return;
        }
        if (target.isBlocking()) {
            target.getItemCooldownManager().set(Items.SHIELD, 120);
            target.sendMessage(Text.literal("Your guard is broken!").formatted(Formatting.RED), true);
            dealDamage(target, 1.4f);
        } else {
            dealDamage(target, 1.1f);
        }
        target.takeKnockback(0.5, this.getX() - target.getX(), this.getZ() - target.getZ());
    }

    private void effectShockCone(ServerPlayerEntity target, double range, float mult) {
        Vec3d forward = target.getPos().subtract(this.getPos()).normalize();
        spawnCone(forward, range);
        for (ServerPlayerEntity p : nearbyPlayers(range)) {
            Vec3d to = p.getPos().subtract(this.getPos()).normalize();
            if (forward.dotProduct(to) > 0.5 && p.isOnGround()) {
                dealDamage(p, mult);
                p.takeKnockback(0.5, -forward.x, -forward.z);
            }
        }
        this.getWorld().playSound(null, getX(), getY(), getZ(), SoundEvents.ENTITY_GENERIC_EXPLODE, SoundCategory.HOSTILE, 0.5f, 1.4f);
    }

    private void effectShockRing(ServerPlayerEntity target, double range, float mult) {
        if (this.getWorld() instanceof ServerWorld sw) {
            for (int r = 1; r <= (int) range; r++) {
                spawnRing(this.getPos(), r, ParticleTypes.EXPLOSION, 2 + r);
            }
        }
        for (ServerPlayerEntity p : nearbyPlayers(range)) {
            double d = this.distanceTo(p);
            float scaled = mult * (float) (1.0 - Math.min(0.7, d / range));
            dealDamage(p, Math.max(0.5f, scaled));
            Vec3d away = p.getPos().subtract(this.getPos()).normalize();
            p.takeKnockback(0.7, -away.x, -away.z);
        }
        this.getWorld().playSound(null, getX(), getY(), getZ(), SoundEvents.ENTITY_GENERIC_EXPLODE, SoundCategory.HOSTILE, 0.9f, 0.8f);
    }

    private void effectGraveStep(ServerPlayerEntity target) {
        Vec3d side = target.getRotationVec(1f).crossProduct(new Vec3d(0, 1, 0)).normalize();
        Vec3d dest = this.getPos().add(side.multiply(this.random.nextBoolean() ? 3 : -3));
        if (tryTeleportNear(dest) && this.getWorld() instanceof ServerWorld sw) {
            sw.spawnParticles(ParticleTypes.LARGE_SMOKE, dest.x, dest.y + 0.5, dest.z, 20, 0.3, 0.5, 0.3, 0.02);
        }
    }

    private void effectCinderArc(ServerPlayerEntity target) {
        Vec3d forward = target.getPos().subtract(this.getPos()).normalize();
        if (this.getWorld() instanceof ServerWorld sw) {
            for (int i = 1; i <= 5; i++) {
                Vec3d p = this.getPos().add(forward.multiply(i));
                sw.spawnParticles(ParticleTypes.FLAME, p.x, p.y + 0.2, p.z, 6, 0.3, 0.1, 0.3, 0.01);
            }
        }
        for (ServerPlayerEntity p : nearbyPlayers(5.0)) {
            Vec3d to = p.getPos().subtract(this.getPos()).normalize();
            if (forward.dotProduct(to) > 0.6) {
                dealDamage(p, 1.0f);
                p.setOnFireFor(2);
            }
        }
    }

    private void effectBrand(ServerPlayerEntity target) {
        target.addStatusEffect(new StatusEffectInstance(StatusEffects.GLOWING, 100, 0));
        this.addStatusEffect(new StatusEffectInstance(StatusEffects.SPEED, 100, 1));
        if (this.getWorld() instanceof ServerWorld sw) {
            sw.spawnParticles(ParticleTypes.SOUL_FIRE_FLAME, target.getX(), target.getBodyY(1.0), target.getZ(), 20, 0.3, 0.5, 0.3, 0.02);
        }
    }

    private void effectDashThrough(ServerPlayerEntity target, float mult) {
        Vec3d dir = target.getPos().subtract(this.getPos()).normalize();
        Vec3d dest = target.getPos().add(dir.multiply(2.5));
        boolean along = this.distanceTo(target) < 16;
        if (tryTeleportNear(dest)) {
            dealDamage(target, mult);
            target.takeKnockback(0.3, dir.x, dir.z);
            if (this.getWorld() instanceof ServerWorld sw) {
                sw.spawnParticles(ParticleTypes.END_ROD, target.getX(), target.getBodyY(1.0), target.getZ(), 30, 0.2, 0.4, 0.2, 0.1);
            }
        } else if (along) {
            dealDamage(target, mult * 0.6f);
        }
    }

    private void effectBeam(ServerPlayerEntity target, double range, float mult) {
        Vec3d start = this.getPos().add(0, 1.2, 0);
        Vec3d dir = target.getPos().add(0, 1.0, 0).subtract(start).normalize();
        if (this.getWorld() instanceof ServerWorld sw) {
            for (double d = 1; d <= range; d += 0.5) {
                Vec3d p = start.add(dir.multiply(d));
                sw.spawnParticles(ParticleTypes.END_ROD, p.x, p.y, p.z, 1, 0.03, 0.03, 0.03, 0.0);
            }
        }
        // Damage the first player roughly along the beam lane.
        for (ServerPlayerEntity p : nearbyPlayers(range)) {
            Vec3d to = p.getPos().add(0, 1.0, 0).subtract(start);
            double proj = to.dotProduct(dir);
            if (proj <= 0) continue;
            Vec3d closest = start.add(dir.multiply(proj));
            if (closest.distanceTo(p.getPos().add(0, 1.0, 0)) < 1.6) {
                dealDamage(p, mult);
            }
        }
        this.getWorld().playSound(null, getX(), getY(), getZ(), SoundEvents.ENTITY_ILLUSIONER_CAST_SPELL, SoundCategory.HOSTILE, 0.8f, 0.9f);
    }

    private void effectSnare(ServerPlayerEntity target) {
        BlockPos at = target.getBlockPos();
        if (this.getWorld() instanceof ServerWorld sw) {
            spawnRing(Vec3d.ofBottomCenter(at), 1.5, ParticleTypes.WITCH, 30);
        }
        for (ServerPlayerEntity p : nearbyPlayers(3.0)) {
            if (p.getBlockPos().isWithinDistance(at, 3.0)) {
                p.addStatusEffect(new StatusEffectInstance(StatusEffects.SLOWNESS, 60, 2));
            }
        }
    }

    private void effectChain(ServerPlayerEntity target) {
        Vec3d dir = this.getPos().subtract(target.getPos()).normalize();
        if (this.getWorld() instanceof ServerWorld sw) {
            for (double d = 1; d < this.distanceTo(target); d += 0.5) {
                Vec3d p = target.getPos().add(dir.multiply(d)).add(0, 1, 0);
                sw.spawnParticles(ParticleTypes.SQUID_INK, p.x, p.y, p.z, 1, 0.0, 0.0, 0.0, 0.0);
            }
        }
        // Pull the fleeing player back toward the fight.
        target.addVelocity(dir.x * 0.9, 0.25, dir.z * 0.9);
        target.velocityModified = true;
        this.getWorld().playSound(null, getX(), getY(), getZ(), SoundEvents.ENTITY_LEASH_KNOT_BREAK, SoundCategory.HOSTILE, 1.0f, 0.6f);
    }

    private void effectNightRend(ServerPlayerEntity target, int activeTick) {
        if ((activeTick == 1 || activeTick == 6 || activeTick == 12) && this.distanceTo(target) < 4.0) {
            float mult = activeTick == 12 ? 1.3f : 0.7f;
            dealDamage(target, mult);
            if (activeTick == 12) {
                target.takeKnockback(0.5, this.getX() - target.getX(), this.getZ() - target.getZ());
                if (this.getWorld() instanceof ServerWorld sw) {
                    sw.spawnParticles(ParticleTypes.SOUL_FIRE_FLAME, target.getX(), target.getBodyY(1.0), target.getZ(), 20, 0.3, 0.3, 0.3, 0.05);
                }
            }
        }
    }

    private void effectStarfall(ServerPlayerEntity target, int activeTick) {
        if (activeTick == 1) {
            this.setVelocity(0, 0.9, 0);
            this.velocityModified = true;
        }
        if (activeTick == 6) {
            Vec3d dir = target.getPos().subtract(this.getPos());
            this.setVelocity(dir.x * 0.2, -0.6, dir.z * 0.2);
            this.velocityModified = true;
            effectShockRing(target, 6.0, 1.3f);
        }
    }

    private void effectCrownedFlash(ServerPlayerEntity target, int activeTick) {
        if (activeTick == 1 || activeTick == 4) {
            Vec3d dir = target.getRotationVec(1f).rotateY((float) (Math.PI / 2 * (activeTick == 1 ? 1 : -1)));
            Vec3d dest = target.getPos().add(dir.multiply(3));
            if (tryTeleportNear(dest) && this.getWorld() instanceof ServerWorld sw) {
                sw.spawnParticles(ParticleTypes.END_ROD, this.getX(), this.getBodyY(1.0), this.getZ(), 20, 0.2, 0.4, 0.2, 0.1);
            }
        }
        if (activeTick == 7 && this.distanceTo(target) < 4.0) {
            dealDamage(target, 1.3f);
            target.takeKnockback(0.5, this.getX() - target.getX(), this.getZ() - target.getZ());
        }
    }

    // ----------------------------------------------------------------- helpers

    private List<ServerPlayerEntity> nearbyPlayers(double range) {
        List<ServerPlayerEntity> out = new ArrayList<>();
        for (PlayerEntity p : this.getWorld().getPlayers()) {
            if (p instanceof ServerPlayerEntity sp && !sp.isCreative() && !sp.isSpectator()
                    && this.distanceTo(sp) <= range) {
                out.add(sp);
            }
        }
        return out;
    }

    private void spawnRing(Vec3d center, double radius, net.minecraft.particle.ParticleEffect particle, int count) {
        if (!(this.getWorld() instanceof ServerWorld sw)) {
            return;
        }
        for (int i = 0; i < count; i++) {
            double a = (Math.PI * 2 * i) / count;
            double x = center.x + Math.cos(a) * radius;
            double z = center.z + Math.sin(a) * radius;
            sw.spawnParticles(particle, x, center.y + 0.1, z, 1, 0.0, 0.0, 0.0, 0.0);
        }
    }

    private void spawnCone(Vec3d forward, double range) {
        if (!(this.getWorld() instanceof ServerWorld sw)) {
            return;
        }
        for (double d = 1; d <= range; d += 1.0) {
            Vec3d p = this.getPos().add(forward.multiply(d));
            sw.spawnParticles(ParticleTypes.CLOUD, p.x, p.y + 0.1, p.z, 4, 0.3 * d / range, 0.05, 0.3 * d / range, 0.01);
        }
    }

    private boolean tryTeleportNear(Vec3d desired) {
        BlockPos base = BlockPos.ofFloored(desired);
        for (int dy = 3; dy >= -3; dy--) {
            BlockPos feet = base.up(dy);
            if (isSafeStand(feet)) {
                this.getNavigation().stop();
                this.requestTeleport(feet.getX() + 0.5, feet.getY(), feet.getZ() + 0.5);
                return true;
            }
        }
        return false;
    }

    private boolean isSafeStand(BlockPos feet) {
        World w = this.getWorld();
        return w.getBlockState(feet).getCollisionShape(w, feet).isEmpty()
                && w.getBlockState(feet.up()).getCollisionShape(w, feet.up()).isEmpty()
                && !w.getBlockState(feet.down()).getCollisionShape(w, feet.down()).isEmpty()
                && w.getFluidState(feet).isEmpty();
    }

    private void repelBystanderMobs() {
        List<net.minecraft.entity.Entity> around = this.getWorld().getOtherEntities(this,
                this.getBoundingBox().expand(10), e -> e instanceof HostileEntity && !(e instanceof MarauderEntity));
        for (net.minecraft.entity.Entity e : around) {
            Vec3d away = e.getPos().subtract(this.getPos()).normalize();
            e.addVelocity(away.x * 0.6, 0.3, away.z * 0.6);
            e.velocityModified = true;
        }
    }

    private void addBossBarPlayer(ServerPlayerEntity target) {
        if (bossBar == null) {
            return;
        }
        bossBar.addPlayer(target);
        for (ServerPlayerEntity p : nearbyPlayers(40)) {
            bossBar.addPlayer(p);
        }
    }

    private void removeBossBar() {
        if (bossBar != null) {
            bossBar.clearPlayers();
            bossBar = null;
        }
    }

    private void tickCooldowns() {
        if (cooldowns.isEmpty()) {
            return;
        }
        cooldowns.replaceAll((a, v) -> Math.max(0, v - 1));
    }

    private void clientParticles() {
        Behavior b = getBehaviorState();
        if (b == Behavior.FINAL_WAIT && this.age % 6 == 0) {
            this.getWorld().addParticle(ParticleTypes.SOUL_FIRE_FLAME,
                    this.getX() + (this.random.nextDouble() - 0.5) * 0.6,
                    this.getY() + 1.6,
                    this.getZ() + (this.random.nextDouble() - 0.5) * 0.6, 0, 0.01, 0);
        }
        if (getStage() >= 5 && b.isCombat() && this.age % 3 == 0) {
            this.getWorld().addParticle(ParticleTypes.SMOKE,
                    this.getX() + (this.random.nextDouble() - 0.5) * 0.5,
                    this.getY() + 1.0 + this.random.nextDouble() * 0.6,
                    this.getZ() + (this.random.nextDouble() - 0.5) * 0.5, 0, 0.02, 0);
        }
    }

    // ----------------------------------------------------------------- persistence

    @Override
    public void writeCustomDataToNbt(NbtCompound nbt) {
        super.writeCustomDataToNbt(nbt);
        nbt.putInt("MStage", getStage());
        nbt.putInt("MState", this.dataTracker.get(STATE));
        if (targetPlayerUuid != null) {
            nbt.putUuid("MTarget", targetPlayerUuid);
        }
        if (ambushPos != null) {
            nbt.putLong("MAmbush", ambushPos.asLong());
        }
        nbt.putBoolean("MAttempt", attemptRecorded);
    }

    @Override
    public void readCustomDataFromNbt(NbtCompound nbt) {
        super.readCustomDataFromNbt(nbt);
        int stage = nbt.contains("MStage") ? nbt.getInt("MStage") : 1;
        this.dataTracker.set(STAGE, MarauderStages.clamp(stage));
        applyStageAttributes(MarauderStages.clamp(stage));
        if (nbt.containsUuid("MTarget")) {
            targetPlayerUuid = nbt.getUuid("MTarget");
            DuelManager.register(targetPlayerUuid, this);
        }
        if (nbt.contains("MAmbush")) {
            ambushPos = BlockPos.fromLong(nbt.getLong("MAmbush"));
        }
        attemptRecorded = nbt.getBoolean("MAttempt");
        // After a reload, resume in a safe non-combat state; the night manager re-arms us.
        Behavior restored = Behavior.byId(nbt.getInt("MState"));
        if (restored.isCombat() || restored == Behavior.CHALLENGE) {
            setState(MarauderStages.isFinal(stage) ? Behavior.FINAL_WAIT : Behavior.STALKING);
        } else {
            setState(restored);
        }
    }

    @Override
    public void remove(RemovalReason reason) {
        if (!this.getWorld().isClient) {
            removeBossBar();
            if (targetPlayerUuid != null) {
                DuelManager.clear(targetPlayerUuid, this);
            }
        }
        super.remove(reason);
    }

    @Override
    protected net.minecraft.sound.SoundEvent getAmbientSound() {
        return getBehaviorState().isCombat() ? SoundEvents.ENTITY_VINDICATOR_AMBIENT : null;
    }

    @Override
    protected net.minecraft.sound.SoundEvent getHurtSound(DamageSource source) {
        return SoundEvents.ENTITY_IRON_GOLEM_HURT;
    }

    @Override
    protected net.minecraft.sound.SoundEvent getDeathSound() {
        return SoundEvents.ENTITY_RAVAGER_DEATH;
    }
}
