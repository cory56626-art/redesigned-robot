package com.lobber.entity;

import com.lobber.config.LobberConfig;
import com.lobber.entity.goal.LobberCuriosityGoal;
import com.lobber.entity.goal.LobberMischiefGoal;
import com.lobber.entity.goal.LobberPrankGoal;
import com.lobber.entity.goal.LobberStalkGoal;
import com.lobber.entity.goal.LobberThrowBlockGoal;
import net.minecraft.block.BlockState;
import net.minecraft.entity.EntityDimensions;
import net.minecraft.entity.EntityPose;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.ai.goal.ActiveTargetGoal;
import net.minecraft.entity.ai.goal.LookAroundGoal;
import net.minecraft.entity.ai.goal.LookAtEntityGoal;
import net.minecraft.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.entity.ai.goal.RevengeGoal;
import net.minecraft.entity.ai.goal.SwimGoal;
import net.minecraft.entity.ai.goal.WanderAroundFarGoal;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.tag.FluidTags;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundEvent;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

import java.util.UUID;

public class LobberEntity extends HostileEntity {
	private static final TrackedData<Boolean> PROVOKED =
			DataTracker.registerData(LobberEntity.class, TrackedDataHandlerRegistry.BOOLEAN);
	// 0 = freshly spawned hatchling, 100 = fully matured stalker. Tracked so the client can scale it.
	private static final TrackedData<Integer> GROWTH =
			DataTracker.registerData(LobberEntity.class, TrackedDataHandlerRegistry.INTEGER);
	// 0..100 trust toward its bonded player. Tracked so the info screen can read it client-side.
	private static final TrackedData<Integer> TRUST =
			DataTracker.registerData(LobberEntity.class, TrackedDataHandlerRegistry.INTEGER);

	public static final int MAX_TRUST = 100;
	// At/above this, a young Lobber is your friend (no pranks) and a mature one extends a grace period.
	public static final int TRUST_FRIENDLY = 20;

	// Once the target is lost, the Lobber stays angry for a little while before calming back into a stalker.
	private int calmCooldown = 0;
	// Ticks spent stalking a player; drives maturity.
	private long maturityTicks = 0L;
	// The single player this Lobber has fixated on.
	private UUID bondedPlayer = null;
	// Brief cooldown between hand-pets so trust can't be spammed up instantly.
	private int petCooldown = 0;
	// The malicious adult behavior engine, only used once mature.
	private final LobberMatureBehavior matureBehavior = new LobberMatureBehavior();

	public LobberEntity(EntityType<? extends HostileEntity> entityType, World world) {
		super(entityType, world);
		this.experiencePoints = 8;
	}

	public static DefaultAttributeContainer.Builder createLobberAttributes() {
		return HostileEntity.createHostileAttributes()
				.add(EntityAttributes.GENERIC_MAX_HEALTH, 30.0)
				.add(EntityAttributes.GENERIC_MOVEMENT_SPEED, 0.32)
				.add(EntityAttributes.GENERIC_ATTACK_DAMAGE, 4.0)
				.add(EntityAttributes.GENERIC_FOLLOW_RANGE, 48.0)
				.add(EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, 0.3);
	}

	@Override
	protected void initGoals() {
		this.goalSelector.add(0, new SwimGoal(this));
		this.goalSelector.add(2, new LobberThrowBlockGoal(this));
		this.goalSelector.add(3, new MeleeAttackGoal(this, 1.25, false));
		this.goalSelector.add(4, new LobberCuriosityGoal(this));
		this.goalSelector.add(5, new LobberPrankGoal(this));
		this.goalSelector.add(6, new LobberMischiefGoal(this));
		this.goalSelector.add(7, new LobberStalkGoal(this));
		this.goalSelector.add(8, new WanderAroundFarGoal(this, 0.8));
		this.goalSelector.add(9, new LookAtEntityGoal(this, PlayerEntity.class, 14.0f));
		this.goalSelector.add(10, new LookAroundGoal(this));

		this.targetSelector.add(1, new RevengeGoal(this));
		// Only ever actually targets a player once it has been provoked.
		this.targetSelector.add(2, new ActiveTargetGoal<>(this, PlayerEntity.class, 10, true, false,
				living -> this.isProvoked()));
	}

	@Override
	protected void initDataTracker() {
		super.initDataTracker();
		this.dataTracker.startTracking(PROVOKED, false);
		this.dataTracker.startTracking(GROWTH, 0);
		this.dataTracker.startTracking(TRUST, 0);
	}

	public boolean isProvoked() {
		return this.dataTracker.get(PROVOKED);
	}

	public void setProvoked(boolean provoked) {
		this.dataTracker.set(PROVOKED, provoked);
	}

	/** 0..100 maturity. */
	public int getGrowth() {
		return this.dataTracker.get(GROWTH);
	}

	public void setGrowth(int growth) {
		this.dataTracker.set(GROWTH, Math.max(0, Math.min(100, growth)));
	}

	/** Sets growth AND the underlying maturity timer so /lobber age doesn't get undone next tick. */
	public void debugSetGrowth(int growth) {
		int clamped = Math.max(0, Math.min(100, growth));
		this.setGrowth(clamped);
		this.maturityTicks = (long) LobberConfig.INSTANCE.daysToMature * 24000L * clamped / 100L;
	}

	public boolean isMature() {
		return this.getGrowth() >= 100;
	}

	public boolean hasActiveEvent() {
		return this.matureBehavior.hasActiveEvent();
	}

	/** 0..100 trust toward the bonded player. */
	public int getTrust() {
		return this.dataTracker.get(TRUST);
	}

	public void setTrust(int trust) {
		this.dataTracker.set(TRUST, Math.max(0, Math.min(MAX_TRUST, trust)));
	}

	public void addTrust(int delta) {
		this.setTrust(this.getTrust() + delta);
	}

	/** True while trust is high enough to keep the Lobber friendly toward its bonded player. */
	public boolean isFriendly() {
		return this.getTrust() >= TRUST_FRIENDLY;
	}

	public UUID getBondedPlayerUuid() {
		return this.bondedPlayer;
	}

	public void setBondedPlayer(UUID uuid) {
		this.bondedPlayer = uuid;
	}

	private PlayerEntity getBondedPlayer() {
		if (this.bondedPlayer != null) {
			PlayerEntity p = this.getWorld().getPlayerByUuid(this.bondedPlayer);
			if (p != null && p.isAlive() && !p.isSpectator()) {
				return p;
			}
		}
		// No bond yet (or it's gone): latch onto the nearest reasonable player.
		PlayerEntity nearest = this.getWorld().getClosestPlayer(this, 24.0);
		if (nearest != null && !nearest.isSpectator() && this.bondedPlayer == null) {
			this.bondedPlayer = nearest.getUuid();
		}
		return nearest;
	}

	/** Used by the /lobber event test command to force a specific mature event. */
	public boolean triggerEvent(String name) {
		if (this.getWorld() instanceof ServerWorld serverWorld) {
			return this.matureBehavior.forceEvent(name, this, serverWorld);
		}
		return false;
	}

	@Override
	public ActionResult interactMob(PlayerEntity player, Hand hand) {
		if (this.isProvoked()) {
			return super.interactMob(player, hand);
		}
		if (this.getWorld().isClient) {
			// Let the client show the arm swing; the real effect happens server-side.
			return ActionResult.SUCCESS;
		}

		ItemStack stack = player.getStackInHand(hand);
		this.bondedPlayer = player.getUuid();

		if (stack.isFood()) {
			if (!player.getAbilities().creativeMode) {
				stack.decrement(1);
			}
			this.addTrust(8);
			this.spawnTrustParticles();
			this.playSound(SoundEvents.ENTITY_GENERIC_EAT, 0.8f, 1.4f);
			return ActionResult.CONSUME;
		}

		if (stack.isEmpty()) {
			if (this.petCooldown <= 0) {
				this.addTrust(2);
				this.petCooldown = 20;
				this.spawnTrustParticles();
			}
			return ActionResult.SUCCESS;
		}

		return super.interactMob(player, hand);
	}

	private void spawnTrustParticles() {
		if (this.getWorld() instanceof ServerWorld serverWorld) {
			serverWorld.spawnParticles(ParticleTypes.HEART,
					this.getX(), this.getEyeY() + 0.3, this.getZ(), 3, 0.3, 0.3, 0.3, 0.0);
		}
	}

	/** Visual + hitbox scale: small goblin when young, full-size when matured. */
	public float getGrowthScale() {
		return 0.5f + 0.5f * (this.getGrowth() / 100.0f);
	}

	@Override
	public EntityDimensions getDimensions(EntityPose pose) {
		return super.getDimensions(pose).scaled(this.getGrowthScale());
	}

	@Override
	protected float getActiveEyeHeight(EntityPose pose, EntityDimensions dimensions) {
		return dimensions.height * 0.85f;
	}

	@Override
	public void onTrackedDataSet(TrackedData<?> data) {
		if (GROWTH.equals(data)) {
			this.calculateDimensions();
		}
		super.onTrackedDataSet(data);
	}

	/** Exposes the internal teleport for the mature-behavior event engine. */
	public boolean lobberTeleport(double x, double y, double z) {
		return this.teleportTo(x, y, z);
	}

	@Override
	public void writeCustomDataToNbt(NbtCompound nbt) {
		super.writeCustomDataToNbt(nbt);
		nbt.putBoolean("Provoked", this.isProvoked());
		nbt.putInt("Growth", this.getGrowth());
		nbt.putInt("Trust", this.getTrust());
		nbt.putLong("Maturity", this.maturityTicks);
		if (this.bondedPlayer != null) {
			nbt.putUuid("BondedPlayer", this.bondedPlayer);
		}
		this.matureBehavior.writeNbt(nbt);
	}

	@Override
	public void readCustomDataFromNbt(NbtCompound nbt) {
		super.readCustomDataFromNbt(nbt);
		this.setProvoked(nbt.getBoolean("Provoked"));
		this.setGrowth(nbt.getInt("Growth"));
		this.setTrust(nbt.getInt("Trust"));
		this.maturityTicks = nbt.getLong("Maturity");
		if (nbt.containsUuid("BondedPlayer")) {
			this.bondedPlayer = nbt.getUuid("BondedPlayer");
		}
		this.matureBehavior.readNbt(nbt);
	}

	@Override
	public boolean damage(DamageSource source, float amount) {
		if (!this.getWorld().isClient && source.getAttacker() != null) {
			// Betrayal costs trust no matter the age.
			this.addTrust(-15);
			if (this.isMature()) {
				// A grown Lobber forgives only while real trust remains; otherwise it turns on you.
				if (!this.isFriendly()) {
					this.setProvoked(true);
					this.calmCooldown = 600;
				}
			} else if (source.getAttacker() instanceof PlayerEntity player) {
				// A youngster is too timid to fight back - it just bolts, hurt.
				this.fleeFrom(player);
			}
		}
		return super.damage(source, amount);
	}

	@Override
	public void tick() {
		super.tick();
		if (!this.getWorld().isClient) {
			this.serverBehaviorTick();
		}
	}

	private void serverBehaviorTick() {
		if (this.petCooldown > 0) {
			this.petCooldown--;
		}

		if (this.isProvoked()) {
			if (this.getTarget() != null && this.getTarget().isAlive()) {
				this.calmCooldown = 600;
			} else if (--this.calmCooldown <= 0) {
				this.setProvoked(false);
			}
			return;
		}

		this.ageUp();
		this.trustTick();

		// Once fully grown AND the grace of trust has run out, the harassment campaign takes over.
		if (this.isMature() && !this.isFriendly() && this.getWorld() instanceof ServerWorld serverWorld) {
			this.matureBehavior.tick(this, serverWorld);
		}

		PlayerEntity nearest = this.getWorld().getClosestPlayer(this, 32.0);
		if (nearest == null) {
			return;
		}

		// Being looked at only sets off a grown, untrusting Lobber. Young or befriended ones tolerate it.
		if (this.isPlayerStaring(nearest) && this.isMature() && !this.isFriendly()) {
			this.setProvoked(true);
			this.setTarget(nearest);
			this.calmCooldown = 600;
			this.playSound(SoundEvents.ENTITY_ENDERMAN_STARE, this.getSoundVolume(), 0.8f);
		}
	}

	/** Builds trust while young and calm; spends it down (the grace period) once mature. */
	private void trustTick() {
		if (!this.isMature()) {
			// Curious youngster warms up to a player who hangs around peacefully and doesn't hit it.
			PlayerEntity bonded = this.getBondedPlayer();
			if (bonded != null && this.hurtTime == 0 && this.squaredDistanceTo(bonded) < 36.0
					&& this.getTrust() < MAX_TRUST && this.age % 40 == 0) {
				this.addTrust(bonded.isSneaking() ? 2 : 1);
			}
		} else {
			// Grown: the friendship slowly fades, eventually exposing its true nature.
			if (this.getTrust() > 0 && this.age % 100 == 0) {
				this.addTrust(-1);
			}
		}
	}

	private void ageUp() {
		if (this.getGrowth() >= 100) {
			return;
		}
		// It only matures while it has a player to stalk.
		if (this.getWorld().getClosestPlayer(this, 64.0) == null) {
			return;
		}
		this.maturityTicks++;
		long ticksToMature = (long) LobberConfig.INSTANCE.daysToMature * 24000L;
		int growth = (int) Math.min(100L, this.maturityTicks * 100L / ticksToMature);
		if (growth != this.getGrowth()) {
			this.setGrowth(growth);
		}
	}

	private void fleeFrom(PlayerEntity player) {
		double angle = this.random.nextDouble() * Math.PI * 2.0;
		double distance = 12.0 + this.random.nextDouble() * 6.0;
		this.teleportTo(
				player.getX() + Math.cos(angle) * distance,
				player.getY(),
				player.getZ() + Math.sin(angle) * distance);
	}

	private boolean isPlayerStaring(PlayerEntity player) {
		Vec3d look = player.getRotationVec(1.0f).normalize();
		Vec3d toLobber = new Vec3d(
				this.getX() - player.getX(),
				this.getEyeY() - player.getEyeY(),
				this.getZ() - player.getZ());
		double length = toLobber.length();
		if (length == 0.0) {
			return false;
		}
		double dot = look.dotProduct(toLobber.normalize());
		return dot > 1.0 - 0.025 / length && player.canSee(this);
	}

	private boolean teleportTo(double x, double y, double z) {
		World world = this.getWorld();
		BlockPos.Mutable pos = new BlockPos.Mutable(x, y, z);
		while (pos.getY() > world.getBottomY() && !world.getBlockState(pos).blocksMovement()) {
			pos.move(Direction.DOWN);
		}
		BlockState landing = world.getBlockState(pos);
		if (!landing.blocksMovement() || landing.getFluidState().isIn(FluidTags.WATER)) {
			return false;
		}
		boolean moved = this.teleport(x, pos.getY() + 1, z, true);
		if (moved && !this.isSilent()) {
			world.playSound(null, this.prevX, this.prevY, this.prevZ,
					SoundEvents.ENTITY_ENDERMAN_TELEPORT, this.getSoundCategory(), 1.0f, 1.0f);
			this.playSound(SoundEvents.ENTITY_ENDERMAN_TELEPORT, 1.0f, 1.0f);
		}
		return moved;
	}

	/**
	 * Grabs (steals) a nearby block to use as ammo and returns it as an item stack.
	 * Falls back to cobblestone when nothing suitable is in reach.
	 */
	public ItemStack grabAmmo() {
		World world = this.getWorld();
		if (world instanceof ServerWorld) {
			for (int i = 0; i < 12; i++) {
				BlockPos p = this.getBlockPos().add(
						this.random.nextInt(7) - 3,
						this.random.nextInt(4) - 1,
						this.random.nextInt(7) - 3);
				BlockState state = world.getBlockState(p);
				if (state.isAir()) {
					continue;
				}
				if (state.getHardness(world, p) < 0.0f) {
					continue; // unbreakable (bedrock, barrier, ...)
				}
				if (!state.getFluidState().isEmpty()) {
					continue;
				}
				Item item = state.getBlock().asItem();
				if (item == Items.AIR) {
					continue;
				}
				world.breakBlock(p, false); // taken, not dropped
				return new ItemStack(item);
			}
		}
		return new ItemStack(Items.COBBLESTONE);
	}

	@Override
	protected SoundEvent getAmbientSound() {
		// Young Lobbers stay quiet to avoid drawing attention.
		if (this.getGrowth() < 40 && this.random.nextInt(3) != 0) {
			return null;
		}
		return SoundEvents.ENTITY_ENDERMAN_AMBIENT;
	}

	@Override
	protected SoundEvent getHurtSound(DamageSource source) {
		return SoundEvents.ENTITY_ENDERMAN_HURT;
	}

	@Override
	protected SoundEvent getDeathSound() {
		return SoundEvents.ENTITY_ENDERMAN_DEATH;
	}

	@Override
	protected float getSoundVolume() {
		// Hushed when small, full-voiced once grown and bold.
		return 0.25f + 0.75f * (this.getGrowth() / 100.0f);
	}

	@Override
	public float getSoundPitch() {
		// Higher, sillier voice when young; deeper as it matures.
		return super.getSoundPitch() * (1.5f - 0.5f * (this.getGrowth() / 100.0f));
	}
}
