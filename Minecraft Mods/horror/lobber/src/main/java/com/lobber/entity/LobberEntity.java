package com.lobber.entity;

import com.lobber.config.LobberConfig;
import com.lobber.entity.goal.LobberCuriosityGoal;
import com.lobber.entity.goal.LobberMischiefGoal;
import com.lobber.entity.goal.LobberPrankGoal;
import com.lobber.entity.goal.LobberStalkGoal;
import com.lobber.entity.goal.LobberThrowBlockGoal;
import com.lobber.entity.goal.LobberWorkGoal;
import net.minecraft.block.BlockState;
import net.minecraft.entity.EntityDimensions;
import net.minecraft.entity.EntityPose;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.ai.goal.ActiveTargetGoal;
import net.minecraft.entity.ai.goal.LookAroundGoal;
import net.minecraft.entity.ai.goal.LookAtEntityGoal;
import net.minecraft.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.entity.ai.goal.SwimGoal;
import net.minecraft.entity.ai.goal.WanderAroundFarGoal;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.inventory.Inventories;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.item.MiningToolItem;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.registry.tag.FluidTags;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvent;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.collection.DefaultedList;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

import java.util.UUID;

public class LobberEntity extends HostileEntity {
	private static final TrackedData<Boolean> PROVOKED =
			DataTracker.registerData(LobberEntity.class, TrackedDataHandlerRegistry.BOOLEAN);
	private static final TrackedData<Integer> GROWTH =
			DataTracker.registerData(LobberEntity.class, TrackedDataHandlerRegistry.INTEGER);
	private static final TrackedData<Integer> TRUST =
			DataTracker.registerData(LobberEntity.class, TrackedDataHandlerRegistry.INTEGER);
	private static final TrackedData<Integer> WORK_TYPE =
			DataTracker.registerData(LobberEntity.class, TrackedDataHandlerRegistry.INTEGER);
	// Drives the adult model's stalker poses on the client.
	private static final TrackedData<Integer> STALK_POSE =
			DataTracker.registerData(LobberEntity.class, TrackedDataHandlerRegistry.INTEGER);

	public static final int MAX_TRUST = 100;
	public static final int MIN_TRUST = -100;
	public static final int TRUST_FRIENDLY = 20;

	public static final int POSE_NEUTRAL = 0;
	public static final int POSE_HUNT = 1;
	public static final int POSE_LEAN = 2;
	public static final int POSE_STARE = 3;

	// Work categories.
	public static final int WORK_NONE = 0;
	public static final int WORK_ORES = 1;
	public static final int WORK_WOOD = 2;
	public static final int WORK_STONE = 3;
	private static final int WORK_SLOTS = 9;

	private long maturityTicks = 0L;
	private UUID bondedPlayer = null;
	private int petCooldown = 0;
	private int poseCooldown = 0;

	// Aggression is time-limited and escalates: the Lobber fights for a while, vanishes, and returns angrier.
	private int aggressionLevel = 0;
	private int aggroTimer = 0;

	// Worker companion state.
	private ItemStack workTool = ItemStack.EMPTY;
	private final DefaultedList<ItemStack> workItems = DefaultedList.ofSize(WORK_SLOTS, ItemStack.EMPTY);

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
		this.goalSelector.add(4, new LobberWorkGoal(this));
		this.goalSelector.add(5, new LobberCuriosityGoal(this));
		this.goalSelector.add(6, new LobberPrankGoal(this));
		this.goalSelector.add(7, new LobberMischiefGoal(this));
		this.goalSelector.add(8, new LobberStalkGoal(this));
		this.goalSelector.add(9, new WanderAroundFarGoal(this, 0.8));
		this.goalSelector.add(10, new LookAtEntityGoal(this, PlayerEntity.class, 14.0f));
		this.goalSelector.add(11, new LookAroundGoal(this));

		// Only targets a player while actively provoked (a grown Lobber's time-limited hunt).
		this.targetSelector.add(1, new ActiveTargetGoal<>(this, PlayerEntity.class, 10, true, false,
				living -> this.isProvoked()));
	}

	@Override
	protected void initDataTracker() {
		super.initDataTracker();
		this.dataTracker.startTracking(PROVOKED, false);
		this.dataTracker.startTracking(GROWTH, 0);
		this.dataTracker.startTracking(TRUST, 0);
		this.dataTracker.startTracking(WORK_TYPE, WORK_NONE);
		this.dataTracker.startTracking(STALK_POSE, POSE_NEUTRAL);
	}

	// ------------------------------------------------------------------
	// Simple tracked accessors
	// ------------------------------------------------------------------

	public boolean isProvoked() {
		return this.dataTracker.get(PROVOKED);
	}

	public void setProvoked(boolean provoked) {
		this.dataTracker.set(PROVOKED, provoked);
	}

	public int getGrowth() {
		return this.dataTracker.get(GROWTH);
	}

	public void setGrowth(int growth) {
		this.dataTracker.set(GROWTH, Math.max(0, Math.min(100, growth)));
	}

	public void debugSetGrowth(int growth) {
		int clamped = Math.max(0, Math.min(100, growth));
		this.setGrowth(clamped);
		this.maturityTicks = (long) LobberConfig.INSTANCE.daysToMature * 24000L * clamped / 100L;
	}

	public boolean isMature() {
		return this.getGrowth() >= 100;
	}

	public int getTrust() {
		return this.dataTracker.get(TRUST);
	}

	public void setTrust(int trust) {
		this.dataTracker.set(TRUST, Math.max(MIN_TRUST, Math.min(MAX_TRUST, trust)));
	}

	public void addTrust(int delta) {
		this.setTrust(this.getTrust() + delta);
	}

	public void setBondedPlayer(UUID uuid) {
		this.bondedPlayer = uuid;
	}

	public boolean isFriendly() {
		return this.getTrust() >= TRUST_FRIENDLY;
	}

	public int getStalkPose() {
		return this.dataTracker.get(STALK_POSE);
	}

	private void setStalkPose(int pose) {
		if (this.getStalkPose() != pose) {
			this.dataTracker.set(STALK_POSE, pose);
		}
	}

	public int getWorkType() {
		return this.dataTracker.get(WORK_TYPE);
	}

	public void setWorkType(int type) {
		this.dataTracker.set(WORK_TYPE, type);
	}

	public boolean isWorker() {
		return !this.workTool.isEmpty();
	}

	public ItemStack getWorkTool() {
		return this.workTool;
	}

	public boolean hasActiveEvent() {
		return this.matureBehavior.hasActiveEvent();
	}

	public int getAggression() {
		return this.aggressionLevel;
	}

	// ------------------------------------------------------------------
	// Visuals / dimensions
	// ------------------------------------------------------------------

	/** Visual + hitbox scale: small goblin when young, tall and gaunt once matured. */
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

	public boolean lobberTeleport(double x, double y, double z) {
		return this.teleportTo(x, y, z);
	}

	// ------------------------------------------------------------------
	// Persistence
	// ------------------------------------------------------------------

	@Override
	public void writeCustomDataToNbt(NbtCompound nbt) {
		super.writeCustomDataToNbt(nbt);
		nbt.putBoolean("Provoked", this.isProvoked());
		nbt.putInt("Growth", this.getGrowth());
		nbt.putInt("Trust", this.getTrust());
		nbt.putInt("Aggression", this.aggressionLevel);
		nbt.putInt("WorkType", this.getWorkType());
		nbt.putLong("Maturity", this.maturityTicks);
		if (!this.workTool.isEmpty()) {
			nbt.put("WorkTool", this.workTool.writeNbt(new NbtCompound()));
		}
		Inventories.writeNbt(nbt, this.workItems, true);
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
		this.aggressionLevel = nbt.getInt("Aggression");
		this.setWorkType(nbt.getInt("WorkType"));
		this.maturityTicks = nbt.getLong("Maturity");
		this.workTool = nbt.contains("WorkTool") ? ItemStack.fromNbt(nbt.getCompound("WorkTool")) : ItemStack.EMPTY;
		Inventories.readNbt(nbt, this.workItems);
		if (nbt.containsUuid("BondedPlayer")) {
			this.bondedPlayer = nbt.getUuid("BondedPlayer");
		}
		this.matureBehavior.readNbt(nbt);
	}

	/** Restores grudge/memory carried by {@link LobberState} when a fresh Lobber is spawned. */
	public void applyContinuity(int aggression, int trust, UUID bond) {
		this.aggressionLevel = aggression;
		this.setTrust(trust);
		this.bondedPlayer = bond;
	}

	// ------------------------------------------------------------------
	// Interaction (taming + becoming a worker)
	// ------------------------------------------------------------------

	@Override
	public ActionResult interactMob(PlayerEntity player, Hand hand) {
		if (this.isProvoked()) {
			return super.interactMob(player, hand);
		}
		if (this.getWorld().isClient) {
			return ActionResult.SUCCESS;
		}

		ItemStack stack = player.getStackInHand(hand);
		this.bondedPlayer = player.getUuid();

		// Feed it.
		if (stack.isFood()) {
			if (!player.getAbilities().creativeMode) {
				stack.decrement(1);
			}
			this.addTrust(8);
			this.spawnEmote(ParticleTypes.HEART);
			this.playSound(SoundEvents.ENTITY_GENERIC_EAT, 0.8f, 1.4f);
			return ActionResult.CONSUME;
		}

		// Hand it a tool to make it a little helper (young + at least neutral trust).
		if (!this.isMature() && this.getTrust() >= 0 && !this.isWorker()
				&& stack.getItem() instanceof MiningToolItem) {
			this.workTool = stack.copyWithCount(1);
			if (!player.getAbilities().creativeMode) {
				stack.decrement(1);
			}
			this.setWorkType(WORK_ORES);
			this.spawnEmote(ParticleTypes.HAPPY_VILLAGER);
			this.playSound(SoundEvents.ENTITY_VILLAGER_YES, 0.8f, 1.6f);
			return ActionResult.CONSUME;
		}

		// Empty hand: pet it.
		if (stack.isEmpty()) {
			if (this.petCooldown <= 0) {
				this.addTrust(2);
				this.petCooldown = 20;
				this.spawnEmote(ParticleTypes.HEART);
			}
			return ActionResult.SUCCESS;
		}

		return super.interactMob(player, hand);
	}

	private void spawnEmote(net.minecraft.particle.ParticleEffect particle) {
		if (this.getWorld() instanceof ServerWorld serverWorld) {
			serverWorld.spawnParticles(particle, this.getX(), this.getEyeY() + 0.3, this.getZ(),
					3, 0.3, 0.3, 0.3, 0.0);
		}
	}

	// ------------------------------------------------------------------
	// Worker companion API (used by goal + networking)
	// ------------------------------------------------------------------

	public boolean isWorkerFull() {
		for (ItemStack stack : this.workItems) {
			if (stack.isEmpty()) {
				return false;
			}
		}
		return true;
	}

	/** Adds a mined stack to the little satchel; returns true if anything fit. */
	public boolean addToSatchel(ItemStack stack) {
		boolean added = false;
		for (int i = 0; i < this.workItems.size() && !stack.isEmpty(); i++) {
			ItemStack slot = this.workItems.get(i);
			if (slot.isEmpty()) {
				this.workItems.set(i, stack.copy());
				stack.setCount(0);
				added = true;
			} else if (ItemStack.canCombine(slot, stack)) {
				int room = slot.getMaxCount() - slot.getCount();
				int move = Math.min(room, stack.getCount());
				if (move > 0) {
					slot.increment(move);
					stack.decrement(move);
					added = true;
				}
			}
		}
		return added;
	}

	public void depositToPlayer(PlayerEntity player) {
		for (int i = 0; i < this.workItems.size(); i++) {
			ItemStack stack = this.workItems.get(i);
			if (!stack.isEmpty()) {
				player.getInventory().offerOrDrop(stack);
				this.workItems.set(i, ItemStack.EMPTY);
			}
		}
		this.playSound(SoundEvents.ENTITY_ITEM_PICKUP, 0.8f, 1.4f);
		this.spawnEmote(ParticleTypes.HAPPY_VILLAGER);
	}

	/** Called by the menu packet: give the satchel contents (and optionally the tool) back. */
	public void retrieveItems(PlayerEntity player, boolean takeTool) {
		this.depositToPlayer(player);
		if (takeTool && !this.workTool.isEmpty()) {
			player.getInventory().offerOrDrop(this.workTool);
			this.workTool = ItemStack.EMPTY;
			this.setWorkType(WORK_NONE);
		}
	}

	// ------------------------------------------------------------------
	// Combat (time-limited, escalating)
	// ------------------------------------------------------------------

	private void enterCombat(LivingEntity target) {
		this.setProvoked(true);
		if (target != null) {
			this.setTarget(target);
		}
		// Fights longer the angrier it has become over past encounters.
		this.aggroTimer = 500 + Math.min(this.aggressionLevel, 6) * 200;
		this.playSound(SoundEvents.ENTITY_WARDEN_ANGRY, 1.0f, 0.6f);
	}

	private void tickCombat() {
		PlayerEntity hunted = this.getTarget() instanceof PlayerEntity p
				? p : this.getWorld().getClosestPlayer(this, 24.0);
		if (--this.aggroTimer <= 0 || hunted == null) {
			this.endAggro();
			return;
		}
		if (this.getTarget() == null && hunted != null) {
			this.setTarget(hunted);
		}
		// Haunting pressure: darkness + a slow heartbeat for its quarry.
		if (this.getWorld() instanceof ServerWorld && this.squaredDistanceTo(hunted) < 24 * 24) {
			if (hunted instanceof ServerPlayerEntity sp) {
				sp.addStatusEffect(new StatusEffectInstance(StatusEffects.DARKNESS, 80, 0, false, false));
			}
			if (this.age % 40 == 0) {
				this.getWorld().playSound(null, this.getBlockPos(), SoundEvents.ENTITY_WARDEN_HEARTBEAT,
						SoundCategory.HOSTILE, 1.2f, 0.7f);
			}
		}
	}

	/** Disengage: vanish dramatically, escalate, and let an angrier one return another night. */
	private void endAggro() {
		this.setProvoked(false);
		this.setTarget(null);
		this.aggressionLevel++;

		if (this.getWorld() instanceof ServerWorld serverWorld) {
			serverWorld.spawnParticles(ParticleTypes.LARGE_SMOKE,
					this.getX(), this.getBodyY(0.5), this.getZ(), 30, 0.4, 0.8, 0.4, 0.02);
			this.getWorld().playSound(null, this.getBlockPos(), SoundEvents.ENTITY_ENDERMAN_TELEPORT,
					SoundCategory.HOSTILE, 1.2f, 0.4f);

			LobberState state = LobberState.get(serverWorld);
			state.aggression = this.aggressionLevel;
			state.trust = this.getTrust();
			if (this.bondedPlayer != null) {
				state.hasBond = true;
				state.bondMost = this.bondedPlayer.getMostSignificantBits();
				state.bondLeast = this.bondedPlayer.getLeastSignificantBits();
			}
			state.markDirty();
		}
		// Drop the satchel/tool so the player's stuff isn't lost when it leaves.
		if (this.getWorld() instanceof ServerWorld) {
			for (ItemStack stack : this.workItems) {
				if (!stack.isEmpty()) {
					this.dropStack(stack);
				}
			}
			if (!this.workTool.isEmpty()) {
				this.dropStack(this.workTool);
			}
		}
		this.discard();
	}

	@Override
	public boolean damage(DamageSource source, float amount) {
		if (!this.getWorld().isClient && source.getAttacker() != null) {
			// Betrayal costs trust at any age, and can push a neglected Lobber into the negatives.
			this.addTrust(-15);
			if (this.isMature()) {
				this.enterCombat(source.getAttacker() instanceof LivingEntity le ? le : null);
			} else if (source.getAttacker() instanceof PlayerEntity player) {
				// A youngster is too timid to fight back - it just bolts, hurt.
				this.fleeFrom(player);
			}
		}
		return super.damage(source, amount);
	}

	@Override
	protected void dropInventory() {
		super.dropInventory();
		if (this.getWorld() instanceof ServerWorld) {
			for (ItemStack stack : this.workItems) {
				if (!stack.isEmpty()) {
					this.dropStack(stack);
				}
			}
			if (!this.workTool.isEmpty()) {
				this.dropStack(this.workTool);
			}
		}
	}

	// ------------------------------------------------------------------
	// Tick
	// ------------------------------------------------------------------

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
		this.updatePose();

		if (this.isProvoked()) {
			this.tickCombat();
			return;
		}

		this.ageUp();
		this.trustTick();

		if (this.isMature()) {
			if (this.getWorld() instanceof ServerWorld serverWorld) {
				this.matureBehavior.tick(this, serverWorld);
			}
			// Trust no longer protects a grown Lobber: meeting its gaze begins the hunt.
			PlayerEntity nearest = this.getWorld().getClosestPlayer(this, 32.0);
			if (nearest != null && this.isPlayerStaring(nearest)) {
				this.enterCombat(nearest);
			} else if (nearest != null && this.squaredDistanceTo(nearest) < 18 * 18 && this.age % 160 == 0) {
				// A wrong, distant whisper while it lurks - unsettling without attacking.
				this.getWorld().playSound(null, this.getBlockPos(), SoundEvents.ENTITY_WARDEN_NEARBY_CLOSE,
						SoundCategory.HOSTILE, 0.5f, 0.7f);
			}
		} else {
			// A distrustful youngster keeps its distance.
			if (this.getTrust() < 0) {
				PlayerEntity bonded = this.getBondedPlayer();
				if (bonded != null && this.squaredDistanceTo(bonded) < 25.0 && this.random.nextInt(30) == 0) {
					this.fleeFrom(bonded);
				}
			}
		}
	}

	private void updatePose() {
		if (--this.poseCooldown > 0) {
			return;
		}
		this.poseCooldown = 10;

		if (this.isProvoked()) {
			this.setStalkPose(POSE_HUNT);
			return;
		}
		PlayerEntity player = this.getWorld().getClosestPlayer(this, 20.0);
		if (player == null) {
			this.setStalkPose(POSE_NEUTRAL);
			return;
		}
		if (this.isMature() && this.isBesideTree()) {
			this.setStalkPose(POSE_LEAN); // leans out from behind a tree to watch
		} else if (this.squaredDistanceTo(player) < 18 * 18) {
			this.setStalkPose(POSE_STARE); // a slow, distant stare
		} else {
			this.setStalkPose(POSE_NEUTRAL);
		}
	}

	private boolean isBesideTree() {
		BlockPos pos = this.getBlockPos();
		for (Direction dir : Direction.Type.HORIZONTAL) {
			if (this.getWorld().getBlockState(pos.offset(dir).up()).isIn(BlockTags.LOGS)) {
				return true;
			}
		}
		return false;
	}

	private void ageUp() {
		if (this.getGrowth() >= 100) {
			return;
		}
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

	private void trustTick() {
		if (this.isMature()) {
			return; // trust doesn't really matter to a grown Lobber anymore
		}
		PlayerEntity bonded = this.getBondedPlayer();
		if (bonded != null && this.hurtTime == 0 && this.squaredDistanceTo(bonded) < 36.0
				&& this.getTrust() < MAX_TRUST && this.age % 40 == 0) {
			this.addTrust(bonded.isSneaking() ? 2 : 1);
		}
		// Neglect (ignoring/never feeding it) slowly erodes trust toward the negatives.
		if (this.age % 1200 == 0 && this.getTrust() > MIN_TRUST) {
			this.addTrust(-1);
		}
	}

	private PlayerEntity getBondedPlayer() {
		if (this.bondedPlayer != null) {
			PlayerEntity p = this.getWorld().getPlayerByUuid(this.bondedPlayer);
			if (p != null && p.isAlive() && !p.isSpectator()) {
				return p;
			}
		}
		PlayerEntity nearest = this.getWorld().getClosestPlayer(this, 24.0);
		if (nearest != null && !nearest.isSpectator() && this.bondedPlayer == null) {
			this.bondedPlayer = nearest.getUuid();
		}
		return nearest;
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

	public boolean triggerEvent(String name) {
		if (this.getWorld() instanceof ServerWorld serverWorld) {
			return this.matureBehavior.forceEvent(name, this, serverWorld);
		}
		return false;
	}

	/**
	 * Grabs (steals) a nearby block to use as ammo and returns it as an item stack.
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
					continue;
				}
				if (!state.getFluidState().isEmpty()) {
					continue;
				}
				Item item = state.getBlock().asItem();
				if (item == Items.AIR) {
					continue;
				}
				world.breakBlock(p, false);
				return new ItemStack(item);
			}
		}
		return new ItemStack(Items.COBBLESTONE);
	}

	// ------------------------------------------------------------------
	// Sounds (haunting, age-dependent)
	// ------------------------------------------------------------------

	@Override
	protected SoundEvent getAmbientSound() {
		if (this.getGrowth() < 40 && this.random.nextInt(3) != 0) {
			return null; // young Lobbers stay quiet
		}
		if (this.isMature()) {
			// Deeper, sparser, more wrong sounds when grown.
			return switch (this.random.nextInt(3)) {
				case 0 -> SoundEvents.ENTITY_WARDEN_AMBIENT;
				case 1 -> SoundEvents.AMBIENT_CAVE.value();
				default -> SoundEvents.ENTITY_ENDERMAN_AMBIENT;
			};
		}
		return SoundEvents.ENTITY_ENDERMAN_AMBIENT;
	}

	@Override
	protected SoundEvent getHurtSound(DamageSource source) {
		return this.isMature() ? SoundEvents.ENTITY_WARDEN_HURT : SoundEvents.ENTITY_ENDERMAN_HURT;
	}

	@Override
	protected SoundEvent getDeathSound() {
		return this.isMature() ? SoundEvents.ENTITY_WARDEN_DEATH : SoundEvents.ENTITY_ENDERMAN_DEATH;
	}

	@Override
	protected float getSoundVolume() {
		return 0.25f + 0.75f * (this.getGrowth() / 100.0f);
	}

	@Override
	public float getSoundPitch() {
		return super.getSoundPitch() * (1.5f - 0.6f * (this.getGrowth() / 100.0f));
	}

	@Override
	public int getMaxLookPitchChange() {
		return 60;
	}
}
