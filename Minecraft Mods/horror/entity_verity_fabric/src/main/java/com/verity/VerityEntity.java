package com.verity;

import net.minecraft.block.BlockState;
import net.minecraft.block.DoorBlock;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.ai.goal.ActiveTargetGoal;
import net.minecraft.entity.ai.goal.LookAroundGoal;
import net.minecraft.entity.ai.goal.LookAtEntityGoal;
import net.minecraft.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.entity.ai.goal.SwimGoal;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.Registries;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvent;
import net.minecraft.sound.SoundEvents;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.state.property.Properties;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.RaycastContext;
import net.minecraft.world.World;
import software.bernie.geckolib.animatable.GeoEntity;
import software.bernie.geckolib.core.animatable.instance.AnimatableInstanceCache;
import software.bernie.geckolib.core.animation.AnimatableManager;
import software.bernie.geckolib.core.animation.AnimationController;
import software.bernie.geckolib.core.animation.AnimationState;
import software.bernie.geckolib.core.animation.RawAnimation;
import software.bernie.geckolib.core.object.PlayState;
import software.bernie.geckolib.util.GeckoLibUtil;

public class VerityEntity extends HostileEntity implements GeoEntity {

    // animation state synced to the client (drives GeckoLib)
    private static final TrackedData<Integer> ANIM =
            DataTracker.registerData(VerityEntity.class, TrackedDataHandlerRegistry.INTEGER);

    // behavioral modes (server only)
    private static final int M_IDLE = 0, M_STARE = 1, M_TRANSFORM = 2, M_CHASE = 3,
            M_BREACH = 4, M_SNAP = 5, M_STOP = 6, M_APPROACH = 7, M_MINESHAFT = 8;

    // tuning (ticks / blocks)
    private static final int STARE_TIME = 60, TRANSFORM_TIME = 45, STUCK_LIMIT = 18;
    private static final int BREACH_RANGE = 26, BREACH_COOLDOWN = 140;
    private static final double STALK_NEAR = 14, CHASE_NEAR = 6;

    private final AnimatableInstanceCache cache = GeckoLibUtil.createInstanceCache(this);

    private int mode = M_IDLE;
    private int t0 = 0;
    private double prevDist = -1;
    private int stuck = 0;
    private long nextBreach = 0;

    // breach scratch
    private BlockPos bPos;
    private boolean bDoor;
    private Vec3d bOut, bIn, bStand;

    public VerityEntity(EntityType<? extends HostileEntity> type, World world) {
        super(type, world);
        this.experiencePoints = 0;
    }

    public static DefaultAttributeContainer.Builder createAttributes() {
        return HostileEntity.createHostileAttributes()
                .add(EntityAttributes.GENERIC_MAX_HEALTH, 120.0)
                .add(EntityAttributes.GENERIC_MOVEMENT_SPEED, 0.42)
                .add(EntityAttributes.GENERIC_ATTACK_DAMAGE, 8.0)
                .add(EntityAttributes.GENERIC_FOLLOW_RANGE, 256.0)
                .add(EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, 1.0);
    }

    @Override
    protected void initGoals() {
        this.goalSelector.add(0, new SwimGoal(this));
        this.goalSelector.add(2, new MeleeAttackGoal(this, 1.4D, true));
        this.goalSelector.add(8, new LookAtEntityGoal(this, PlayerEntity.class, 16.0F));
        this.goalSelector.add(9, new LookAroundGoal(this));
        this.targetSelector.add(1, new ActiveTargetGoal<>(this, PlayerEntity.class, false));
    }

    @Override
    protected void initDataTracker() {
        super.initDataTracker();
        this.dataTracker.startTracking(ANIM, 0);
    }

    public int getAnim() { return this.dataTracker.get(ANIM); }
    public void setAnim(int v) { if (getAnim() != v) this.dataTracker.set(ANIM, v); }

    @Override
    public boolean isFireImmune() { return true; }

    @Override
    public boolean canImmediatelyDespawn(double distanceSquared) { return false; }

    @Override
    protected boolean isDisallowedInPeaceful() { return false; }

    // ===== behavior =====
    @Override
    protected void mobTick() {
        super.mobTick();
        if (this.getWorld().isClient) return;
        ServerWorld sw = (ServerWorld) this.getWorld();

        // continuous scream while chasing (the file is already loud; volume widens the range)
        if (mode == M_CHASE && this.age % 55 == 0) {
            playAt(EntityVerityMod.SCREAM, 3.0f, 0.65f + this.getRandom().nextFloat() * 0.2f);
        }

        PlayerEntity player = this.getWorld().getClosestPlayer(this, 64.0);
        if (player == null) { setAnim(0); mode = M_IDLE; return; }
        double d = this.distanceTo(player);

        switch (mode) {
            case M_STOP:
                freeze(); setAnim(0);
                if (d <= STALK_NEAR && hasLos(player)) setMode(M_IDLE);
                break;
            case M_STARE:
                freeze(); facePlayer(player); setAnim(8);
                if (d <= CHASE_NEAR) { startChase(); break; }
                if (this.age - t0 >= STARE_TIME) startTransform();
                break;
            case M_TRANSFORM: {
                freeze(); facePlayer(player); setAnim(6);
                int el = this.age - t0;
                if (el == 0 || el == 10 || el == 18 || el == 26 || el == 34) playAt(EntityVerityMod.BONECRACK, 2.0f, 1.0f);
                if (el >= TRANSFORM_TIME) startChase();
                break;
            }
            case M_SNAP:
                freeze(); setAnim(9);
                if (this.age - t0 >= 12) startChase();
                break;
            case M_APPROACH:
                setAnim(4);
                if (d <= CHASE_NEAR) { startChase(); break; }
                approachStep(player);
                break;
            case M_MINESHAFT:
                freeze(); facePlayer(player); setAnim(8);
                if (d <= CHASE_NEAR + 1) setMode(M_SNAP);
                break;
            case M_BREACH:
                tickBreach(sw, player);
                break;
            case M_CHASE:
                setAnim(2);
                tryClimb(player);
                if (prevDist < 0) prevDist = d;
                if (d < prevDist - 0.05) stuck = 0; else stuck++;
                prevDist = d;
                if (this.getWorld().getTime() >= nextBreach && d > CHASE_NEAR && d <= BREACH_RANGE && stuck >= STUCK_LIMIT) {
                    stuck = 0; prevDist = -1;
                    BlockPos door = findDoor(player);
                    BlockPos glass = findGlass(player);
                    if (door != null && glass != null) {
                        if (this.getRandom().nextFloat() < 0.6f) beginBreach(glass, false, player);
                        else beginBreach(door, true, player);
                    } else if (glass != null) beginBreach(glass, false, player);
                    else if (door != null) beginBreach(door, true, player);
                }
                break;
            default:
                if (mineshaftCheck(player)) { setMode(M_MINESHAFT); break; }
                if (d <= CHASE_NEAR) { startChase(); break; }
                if (d <= STALK_NEAR && hasLos(player)) { setMode(M_STARE); break; }
                if (d <= 40) { startChase(); break; }
                setAnim(0);
        }
    }

    private void setMode(int m) { mode = m; t0 = this.age; }
    private void startChase() { setMode(M_CHASE); setAnim(2); prevDist = -1; stuck = 0; this.setInvisible(false); }
    private void startTransform() { setMode(M_TRANSFORM); setAnim(6); playAt(EntityVerityMod.BONECRACK, 2.0f, 1.0f); }

    private void freeze() {
        this.getNavigation().stop();
        this.setVelocity(0, this.getVelocity().y, 0);
        this.velocityModified = true;
    }

    private void facePlayer(PlayerEntity p) {
        this.getLookControl().lookAt(p.getX(), p.getEyeY(), p.getZ());
        double dx = p.getX() - this.getX(), dz = p.getZ() - this.getZ();
        float yaw = (float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0);
        this.setYaw(yaw);
        this.bodyYaw = yaw;
        this.headYaw = yaw;
    }

    private void approachStep(PlayerEntity p) {
        Vec3d dir = new Vec3d(p.getX() - this.getX(), 0, p.getZ() - this.getZ()).normalize();
        this.refreshPositionAndAngles(this.getX() + dir.x * 0.12, this.getY(), this.getZ() + dir.z * 0.12, this.getYaw(), this.getPitch());
        facePlayer(p);
    }

    private void tryClimb(PlayerEntity p) {
        double dy = p.getY() - this.getY();
        if (dy < 1.2) return;
        double dx = p.getX() - this.getX(), dz = p.getZ() - this.getZ();
        if (dx * dx + dz * dz > 6.25) return;
        double l = Math.sqrt(dx * dx + dz * dz); if (l < 0.01) l = 1;
        int sx = (int) Math.round(dx / l), sz = (int) Math.round(dz / l);
        BlockPos front = this.getBlockPos().add(sx, 1, sz);
        if (this.getWorld().getBlockState(front).isAir()) return;
        setAnim(3);
        if (this.getWorld().getBlockState(this.getBlockPos().up(3)).isAir()) {
            this.addStatusEffect(new StatusEffectInstance(StatusEffects.LEVITATION, 12, 1, false, false));
        }
    }

    private boolean mineshaftCheck(PlayerEntity p) {
        if (this.getY() - p.getY() < 4) return false;
        if (!this.getWorld().getBlockState(this.getBlockPos().up(3)).isAir()) return false;
        double dx = this.getX() - p.getX(), dz = this.getZ() - p.getZ();
        return dx * dx + dz * dz < 16;
    }

    private boolean hasLos(PlayerEntity p) {
        HitResult hit = this.getWorld().raycast(new RaycastContext(
                this.getEyePos(), p.getEyePos(),
                RaycastContext.ShapeType.COLLIDER, RaycastContext.FluidHandling.NONE, this));
        return hit.getType() == HitResult.Type.MISS;
    }

    private boolean isGlass(BlockState st) {
        return Registries.BLOCK.getId(st.getBlock()).getPath().contains("glass");
    }

    private BlockPos findGlass(PlayerEntity p) { return findBlock(p, 12, 4, true); }
    private BlockPos findDoor(PlayerEntity p) { return findBlock(p, 12, 2, false); }

    private BlockPos findBlock(PlayerEntity p, int rad, int vrad, boolean glass) {
        BlockPos pp = p.getBlockPos();
        BlockPos best = null; double bd = Double.MAX_VALUE;
        for (int dy = -vrad; dy <= vrad; dy++)
            for (int dx = -rad; dx <= rad; dx++)
                for (int dz = -rad; dz <= rad; dz++) {
                    BlockPos b = pp.add(dx, dy, dz);
                    BlockState st = this.getWorld().getBlockState(b);
                    boolean match = glass ? isGlass(st) : (st.getBlock() instanceof DoorBlock);
                    if (!match) continue;
                    double dd = b.getSquaredDistance(this.getBlockPos());
                    if (dd < bd) { bd = dd; best = b; }
                }
        return best;
    }

    private void beginBreach(BlockPos pos, boolean isDoor, PlayerEntity p) {
        setMode(M_BREACH);
        bPos = pos; bDoor = isDoor;
        nextBreach = this.getWorld().getTime() + BREACH_COOLDOWN;
        double tx = p.getX() - (pos.getX() + 0.5), tz = p.getZ() - (pos.getZ() + 0.5);
        double l = Math.sqrt(tx * tx + tz * tz); if (l < 0.01) l = 1;
        int ix = (int) Math.round(tx / l), iz = (int) Math.round(tz / l);
        bOut = new Vec3d(pos.getX() + 0.5 - ix, pos.getY(), pos.getZ() + 0.5 - iz);
        bIn = new Vec3d(pos.getX() + 0.5 + ix, pos.getY(), pos.getZ() + 0.5 + iz);
        bStand = new Vec3d(p.getX() - ix * 3, p.getY(), p.getZ() - iz * 3);
        setAnim(isDoor ? 4 : 5);
    }

    private void tickBreach(ServerWorld sw, PlayerEntity p) {
        freeze();
        int el = this.age - t0;
        if (bDoor) {
            switch (el) {
                case 0: setAnim(4); break;
                case 30: tp(bOut.x, bOut.y, bOut.z); facePlayer(p); break;
                case 45: openDoor(sw, bPos); playAt(SoundEvents.BLOCK_WOODEN_DOOR_OPEN, 1f, 1f); break;
                case 60: tp(bIn.x, bIn.y, bIn.z); facePlayer(p); break;
                case 80: tp(Math.floor(bStand.x) + 0.5, bStand.y, Math.floor(bStand.z) + 0.5); facePlayer(p); setAnim(8); break;
                case 120: setAnim(9); break;
                case 138: startChase(); break;
            }
        } else {
            switch (el) {
                case 0: setAnim(5); this.setInvisible(true);
                    sw.spawnParticles(ParticleTypes.EXPLOSION_EMITTER, this.getX(), this.getY() + 1, this.getZ(), 1, 0, 0, 0, 0);
                    playAt(SoundEvents.ENTITY_ENDERMAN_TELEPORT, 1f, 1f); break;
                case 20: this.setInvisible(false); tp(bOut.x, bOut.y, bOut.z); facePlayer(p); setAnim(5);
                    playAt(SoundEvents.ENTITY_ENDERMAN_STARE, 1f, 1f); break;
                case 40: breakAt(sw, bPos.up()); playAt(SoundEvents.BLOCK_GLASS_BREAK, 1f, 1f); break;
                case 52: breakAt(sw, bPos); playAt(SoundEvents.BLOCK_GLASS_BREAK, 1f, 1f); break;
                case 64: setAnim(4); tp(bPos.getX() + 0.5, bPos.getY(), bPos.getZ() + 0.5); facePlayer(p); break;
                case 78: tp(bIn.x, bIn.y, bIn.z); facePlayer(p); break;
                case 88: startChase(); break;
            }
        }
    }

    private void tp(double x, double y, double z) {
        this.refreshPositionAndAngles(x, y, z, this.getYaw(), this.getPitch());
    }

    private void breakAt(ServerWorld sw, BlockPos pos) {
        if (isGlass(sw.getBlockState(pos))) sw.breakBlock(pos, false);
    }

    private void openDoor(ServerWorld sw, BlockPos pos) {
        for (BlockPos b : new BlockPos[]{pos, pos.up(), pos.down()}) {
            BlockState st = sw.getBlockState(b);
            if (st.getBlock() instanceof DoorBlock) sw.setBlockState(b, st.with(Properties.OPEN, true));
        }
    }

    private void playAt(SoundEvent e, float vol, float pitch) {
        this.getWorld().playSound(null, this.getX(), this.getY(), this.getZ(), e, SoundCategory.HOSTILE, vol, pitch);
    }

    // ===== command hooks =====
    public void cmdChase() { startChase(); }
    public void cmdStop() { setMode(M_STOP); setAnim(0); this.setTarget(null); }
    public void cmdCome() { setMode(M_APPROACH); setAnim(4); }
    public void cmdDoor(PlayerEntity p) { BlockPos d = findDoor(p); if (d != null) beginBreach(d, true, p); else cmdChase(); }
    public void cmdGlass(PlayerEntity p) { BlockPos g = findGlass(p); if (g != null) beginBreach(g, false, p); else cmdChase(); }

    // ===== GeckoLib =====
    @Override
    public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
        controllers.add(new AnimationController<>(this, "main", 0, this::predicate));
    }

    private PlayState predicate(AnimationState<VerityEntity> state) {
        String name;
        switch (getAnim()) {
            case 2: name = "animation.entity_verity.jitter_sprint"; break;
            case 3: name = "animation.entity_verity.climb"; break;
            case 4: name = "animation.entity_verity.crawl"; break;
            case 5: name = "animation.entity_verity.face_break"; break;
            case 6: name = "animation.entity_verity.transform"; break;
            case 8: name = "animation.entity_verity.stare"; break;
            case 9: name = "animation.entity_verity.snap"; break;
            default: name = "animation.entity_verity.idle_twitch";
        }
        state.getController().setAnimation(RawAnimation.begin().thenLoop(name));
        return PlayState.CONTINUE;
    }

    @Override
    public AnimatableInstanceCache getAnimatableInstanceCache() { return cache; }
}
