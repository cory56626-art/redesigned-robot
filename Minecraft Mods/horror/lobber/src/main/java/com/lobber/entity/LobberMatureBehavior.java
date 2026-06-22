package com.lobber.entity;

import com.lobber.config.LobberConfig;
import net.minecraft.block.AbstractFurnaceBlock;
import net.minecraft.block.BedBlock;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.block.ChestBlock;
import net.minecraft.block.DoorBlock;
import net.minecraft.block.PaneBlock;
import net.minecraft.block.BlockState;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.passive.AnimalEntity;
import net.minecraft.entity.passive.VillagerEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;

import java.util.List;
import java.util.function.Predicate;

/**
 * The malicious side of a fully-grown Lobber. Once mature it stops merely stealing trinkets and
 * starts a slow campaign of harassment against its chosen player, picking events based on the time
 * of day and what it has learned about the player's home.
 */
public class LobberMatureBehavior {
	private static final int EVENT_NONE = 0;
	private static final int EVENT_KNOCK = 1;
	private static final int EVENT_SHATTER = 2;
	private static final int EVENT_BREAK_IN = 3;
	private static final int EVENT_STARE = 4;
	private static final int EVENT_KILL_PET = 5;
	private static final int EVENT_ARSON = 6;
	private static final int EVENT_VILLAGER = 7;

	private int cooldown = 1200;
	private int homeScanCooldown = 100;
	private int activeEvent = EVENT_NONE;
	private int eventTimer = 0;
	private int fireCount = 0;
	private BlockPos eventTarget;
	private LivingEntity eventEntity;

	/** The player's home, learned by spotting doors/beds/etc. while stalking. */
	private BlockPos home;

	public boolean hasActiveEvent() {
		return this.activeEvent != EVENT_NONE;
	}

	public void tick(LobberEntity lob, ServerWorld world) {
		this.updateHome(lob, world);

		if (this.activeEvent != EVENT_NONE) {
			this.tickEvent(lob, world);
			return;
		}
		if (--this.cooldown > 0) {
			return;
		}
		this.startEvent(lob, world);
	}

	// ------------------------------------------------------------------
	// Home tracking
	// ------------------------------------------------------------------

	private void updateHome(LobberEntity lob, ServerWorld world) {
		if (--this.homeScanCooldown > 0) {
			return;
		}
		this.homeScanCooldown = 200;
		PlayerEntity player = world.getClosestPlayer(lob, 28.0);
		if (player == null || player.isSpectator()) {
			return;
		}
		if (findBaseMarker(world, player.getBlockPos()) != null) {
			this.home = player.getBlockPos();
		}
	}

	private static BlockPos findBaseMarker(ServerWorld world, BlockPos center) {
		for (BlockPos pos : BlockPos.iterate(center.add(-6, -4, -6), center.add(6, 4, 6))) {
			Block block = world.getBlockState(pos).getBlock();
			if (block instanceof DoorBlock || block instanceof BedBlock || block instanceof ChestBlock
					|| block == Blocks.CRAFTING_TABLE || block instanceof AbstractFurnaceBlock) {
				return pos.toImmutable();
			}
		}
		return null;
	}

	// ------------------------------------------------------------------
	// Event selection
	// ------------------------------------------------------------------

	private void startEvent(LobberEntity lob, ServerWorld world) {
		this.cooldown = 1200 + lob.getRandom().nextInt(1200); // 1-2 minutes between schemes
		PlayerEntity player = world.getClosestPlayer(lob, 96.0);
		if (player == null) {
			return;
		}

		long timeOfDay = world.getTimeOfDay() % 24000L;
		boolean night = timeOfDay >= 13000L && timeOfDay <= 23000L;
		boolean sleeping = player.isSleeping();
		boolean homeKnown = this.home != null;
		double homeDistSq = homeKnown
				? player.squaredDistanceTo(this.home.getX() + 0.5, this.home.getY(), this.home.getZ() + 0.5)
				: Double.MAX_VALUE;
		LobberConfig cfg = LobberConfig.INSTANCE;

		if (sleeping && homeKnown) {
			if (lob.getRandom().nextBoolean()) {
				this.beginStare(lob, world, player);
			} else if (cfg.enablePetKilling) {
				this.beginKillPet(lob, world, player);
			}
		} else if (night && homeKnown && homeDistSq < 48 * 48) {
			switch (lob.getRandom().nextInt(4)) {
				case 0 -> this.beginKnock(lob, world);
				case 1 -> {
					if (cfg.enableGriefing) {
						this.beginShatter(world);
					}
				}
				case 2 -> this.beginBreakIn(lob, world);
				default -> {
					if (cfg.enablePetKilling) {
						this.beginKillPet(lob, world, player);
					}
				}
			}
		} else if (!night && homeKnown && homeDistSq > 64 * 64) {
			// Player is off exploring - strike the home or the people they love.
			switch (lob.getRandom().nextInt(3)) {
				case 0 -> {
					if (cfg.enableArson) {
						this.beginArson();
					}
				}
				case 1 -> {
					if (cfg.enableVillagerHunting) {
						this.beginVillagerHunt(lob, world);
					}
				}
				default -> {
					if (cfg.enablePetKilling) {
						this.beginKillPet(lob, world, player);
					}
				}
			}
		} else {
			this.beginKnock(lob, world); // idle taunt
		}
	}

	/** Forces a named event for testing via the /lobber command, bypassing config gates. */
	public boolean forceEvent(String name, LobberEntity lob, ServerWorld world) {
		PlayerEntity player = world.getClosestPlayer(lob, 128.0);
		if (this.home == null) {
			this.home = player != null ? player.getBlockPos() : lob.getBlockPos();
		}
		this.endEvent();
		switch (name.toLowerCase()) {
			case "knock" -> this.beginKnock(lob, world);
			case "shatter", "window" -> this.beginShatter(world);
			case "breakin", "break_in" -> this.beginBreakIn(lob, world);
			case "stare" -> {
				if (player != null) {
					this.beginStare(lob, world, player);
				}
			}
			case "killpet", "pet" -> {
				if (player != null) {
					this.beginKillPet(lob, world, player);
				}
			}
			case "arson", "fire" -> this.beginArson();
			case "villager" -> this.beginVillagerHunt(lob, world);
			default -> {
				return false;
			}
		}
		return true;
	}

	private void tickEvent(LobberEntity lob, ServerWorld world) {
		switch (this.activeEvent) {
			case EVENT_KNOCK -> this.tickKnock(lob, world);
			case EVENT_SHATTER -> this.tickShatter(lob, world);
			case EVENT_BREAK_IN -> this.tickBreakIn(lob, world);
			case EVENT_STARE -> this.tickStare(lob, world);
			case EVENT_KILL_PET -> this.tickKillPet(lob, world);
			case EVENT_ARSON -> this.tickArson(world);
			case EVENT_VILLAGER -> this.tickVillagerHunt(lob, world);
			default -> this.endEvent();
		}
	}

	private void endEvent() {
		this.activeEvent = EVENT_NONE;
		this.eventTarget = null;
		this.eventEntity = null;
		this.fireCount = 0;
	}

	// ------------------------------------------------------------------
	// Knocking on the door (taunt)
	// ------------------------------------------------------------------

	private void beginKnock(LobberEntity lob, ServerWorld world) {
		BlockPos door = findNearest(world, lob.getBlockPos(), 16, b -> b instanceof DoorBlock);
		if (door == null && this.home != null) {
			door = findNearest(world, this.home, 14, b -> b instanceof DoorBlock);
		}
		if (door == null) {
			return;
		}
		this.eventTarget = door;
		this.eventTimer = 100;
		this.activeEvent = EVENT_KNOCK;
	}

	private void tickKnock(LobberEntity lob, ServerWorld world) {
		if (this.eventTarget == null || --this.eventTimer <= 0) {
			this.endEvent();
			return;
		}
		lob.getNavigation().startMovingTo(
				this.eventTarget.getX() + 0.5, this.eventTarget.getY(), this.eventTarget.getZ() + 0.5, 1.0);
		lob.getLookControl().lookAt(
				this.eventTarget.getX() + 0.5, this.eventTarget.getY() + 1, this.eventTarget.getZ() + 0.5);
		if (lob.getBlockPos().isWithinDistance(this.eventTarget, 3.0) && this.eventTimer % 14 == 0) {
			world.playSound(null, this.eventTarget, SoundEvents.ENTITY_ZOMBIE_ATTACK_WOODEN_DOOR,
					SoundCategory.HOSTILE, 1.3f, 0.7f);
			world.spawnParticles(ParticleTypes.SMOKE,
					this.eventTarget.getX() + 0.5, this.eventTarget.getY() + 1, this.eventTarget.getZ() + 0.5,
					4, 0.2, 0.2, 0.2, 0.0);
		}
	}

	// ------------------------------------------------------------------
	// Shattering windows
	// ------------------------------------------------------------------

	private void beginShatter(ServerWorld world) {
		if (this.home == null) {
			return;
		}
		BlockPos glass = findNearest(world, this.home, 14, LobberMatureBehavior::isGlass);
		if (glass == null) {
			return;
		}
		this.eventTarget = glass;
		this.eventTimer = 160;
		this.activeEvent = EVENT_SHATTER;
	}

	private void tickShatter(LobberEntity lob, ServerWorld world) {
		if (this.eventTarget == null || --this.eventTimer <= 0) {
			this.endEvent();
			return;
		}
		Vec3d center = Vec3d.ofCenter(this.eventTarget);
		lob.getLookControl().lookAt(center.x, center.y, center.z);

		// Physically stalk up to the window before smashing it.
		if (lob.squaredDistanceTo(center) > 4.0) {
			lob.getNavigation().startMovingTo(center.x, this.eventTarget.getY(), center.z, 1.1);
			return;
		}

		// Arrived: smash the pane (and its neighbours) to taunt, then crawl in after the player.
		if (isGlass(world.getBlockState(this.eventTarget).getBlock())) {
			world.breakBlock(this.eventTarget, false);
			world.playSound(null, this.eventTarget, SoundEvents.BLOCK_GLASS_BREAK,
					SoundCategory.HOSTILE, 1.3f, 0.6f);
			world.spawnParticles(ParticleTypes.CRIT, center.x, center.y, center.z, 16, 0.3, 0.3, 0.3, 0.06);
			for (Direction dir : Direction.values()) {
				BlockPos neighbor = this.eventTarget.offset(dir);
				if (isGlass(world.getBlockState(neighbor).getBlock())) {
					world.breakBlock(neighbor, false);
				}
			}
		}
		// Crawl inside toward the player.
		PlayerEntity player = world.getClosestPlayer(lob, 24.0);
		if (player != null) {
			lob.getNavigation().startMovingTo(player, 1.0);
		}
		if (this.eventTimer > 50) {
			this.eventTimer = 50;
		}
	}

	private static boolean isGlass(Block block) {
		BlockState state = block.getDefaultState();
		boolean pane = block instanceof PaneBlock && block != Blocks.IRON_BARS;
		return pane || state.isIn(BlockTags.IMPERMEABLE);
	}

	// ------------------------------------------------------------------
	// Breaking in (smashing a door open)
	// ------------------------------------------------------------------

	private void beginBreakIn(LobberEntity lob, ServerWorld world) {
		BlockPos door = findNearest(world, this.home != null ? this.home : lob.getBlockPos(), 14,
				b -> b instanceof DoorBlock);
		if (door == null) {
			return;
		}
		this.eventTarget = door;
		this.eventTimer = 120;
		this.activeEvent = EVENT_BREAK_IN;
	}

	private void tickBreakIn(LobberEntity lob, ServerWorld world) {
		if (this.eventTarget == null || --this.eventTimer <= 0) {
			this.endEvent();
			return;
		}
		lob.getNavigation().startMovingTo(
				this.eventTarget.getX() + 0.5, this.eventTarget.getY(), this.eventTarget.getZ() + 0.5, 1.1);
		lob.getLookControl().lookAt(
				this.eventTarget.getX() + 0.5, this.eventTarget.getY() + 1, this.eventTarget.getZ() + 0.5);
		if (lob.getBlockPos().isWithinDistance(this.eventTarget, 2.5)) {
			world.breakBlock(this.eventTarget.up(), false);
			world.breakBlock(this.eventTarget, false);
			world.breakBlock(this.eventTarget.down(), false);
			world.playSound(null, this.eventTarget, SoundEvents.ENTITY_ZOMBIE_BREAK_WOODEN_DOOR,
					SoundCategory.HOSTILE, 1.3f, 0.8f);
			this.endEvent();
		}
	}

	// ------------------------------------------------------------------
	// Staring through a window while the player sleeps
	// ------------------------------------------------------------------

	private void beginStare(LobberEntity lob, ServerWorld world, PlayerEntity player) {
		for (int i = 0; i < 12; i++) {
			double angle = lob.getRandom().nextDouble() * Math.PI * 2.0;
			double dist = 5.0 + lob.getRandom().nextDouble() * 3.0;
			double x = player.getX() + Math.cos(angle) * dist;
			double z = player.getZ() + Math.sin(angle) * dist;
			if (lob.lobberTeleport(x, player.getY(), z) && lob.canSee(player)) {
				this.eventEntity = player;
				this.eventTimer = 160;
				this.activeEvent = EVENT_STARE;
				world.playSound(null, lob.getBlockPos(), SoundEvents.ENTITY_ENDERMAN_STARE,
						SoundCategory.HOSTILE, 1.0f, 0.5f);
				return;
			}
		}
	}

	private void tickStare(LobberEntity lob, ServerWorld world) {
		if (!(this.eventEntity instanceof PlayerEntity player) || !player.isSleeping() || --this.eventTimer <= 0) {
			this.endEvent();
			return;
		}
		lob.getNavigation().stop();
		lob.getLookControl().lookAt(this.eventEntity, 30.0f, 30.0f);
		if (this.eventTimer % 30 == 0) {
			world.spawnParticles(ParticleTypes.SMOKE,
					lob.getX(), lob.getEyeY(), lob.getZ(), 3, 0.1, 0.1, 0.1, 0.0);
			world.playSound(null, lob.getBlockPos(), SoundEvents.ENTITY_ENDERMAN_AMBIENT,
					SoundCategory.HOSTILE, 0.6f, 0.5f);
		}
	}

	// ------------------------------------------------------------------
	// Killing an outdoor pet/animal
	// ------------------------------------------------------------------

	private void beginKillPet(LobberEntity lob, ServerWorld world, PlayerEntity player) {
		BlockPos center = this.home != null ? this.home : player.getBlockPos();
		List<AnimalEntity> animals = world.getEntitiesByClass(AnimalEntity.class,
				new Box(center).expand(16.0),
				a -> a.isAlive() && world.isSkyVisible(a.getBlockPos()));
		if (animals.isEmpty()) {
			return;
		}
		this.eventEntity = animals.get(lob.getRandom().nextInt(animals.size()));
		this.eventTimer = 200;
		this.activeEvent = EVENT_KILL_PET;
	}

	private void tickKillPet(LobberEntity lob, ServerWorld world) {
		if (this.eventEntity == null || !this.eventEntity.isAlive() || --this.eventTimer <= 0) {
			this.endEvent();
			return;
		}
		lob.getNavigation().startMovingTo(this.eventEntity, 1.2);
		lob.getLookControl().lookAt(this.eventEntity, 30.0f, 30.0f);
		if (lob.squaredDistanceTo(this.eventEntity) < 4.0) {
			this.eventEntity.damage(world.getDamageSources().mobAttack(lob), 100.0f);
			world.spawnParticles(ParticleTypes.SMOKE,
					this.eventEntity.getX(), this.eventEntity.getBodyY(0.5), this.eventEntity.getZ(),
					12, 0.3, 0.3, 0.3, 0.02);
			world.playSound(null, this.eventEntity.getBlockPos(), SoundEvents.ENTITY_ENDERMAN_TELEPORT,
					SoundCategory.HOSTILE, 0.8f, 1.4f);
			this.endEvent();
		}
	}

	// ------------------------------------------------------------------
	// Arson - burning the base while the player is away
	// ------------------------------------------------------------------

	private void beginArson() {
		if (this.home == null) {
			return;
		}
		this.eventTarget = this.home;
		this.eventTimer = 160;
		this.fireCount = 0;
		this.activeEvent = EVENT_ARSON;
	}

	private void tickArson(ServerWorld world) {
		// Never burns while the owner is around to see.
		if (world.getClosestPlayer(this.eventTarget.getX(), this.eventTarget.getY(), this.eventTarget.getZ(), 48.0, false) != null) {
			this.endEvent();
			return;
		}
		if (--this.eventTimer <= 0 || this.fireCount >= 6) {
			this.endEvent();
			return;
		}
		if (this.eventTimer % 16 == 0) {
			BlockPos spot = this.findFireSpot(world);
			if (spot != null) {
				world.setBlockState(spot, Blocks.FIRE.getDefaultState(), Block.NOTIFY_ALL);
				this.fireCount++;
				world.playSound(null, spot, SoundEvents.ITEM_FLINTANDSTEEL_USE, SoundCategory.HOSTILE, 1.0f, 0.8f);
			}
		}
	}

	private BlockPos findFireSpot(ServerWorld world) {
		for (int i = 0; i < 24; i++) {
			BlockPos pos = this.eventTarget.add(
					world.random.nextInt(11) - 5,
					world.random.nextInt(5) - 1,
					world.random.nextInt(11) - 5);
			if (world.getBlockState(pos).isAir()
					&& world.getBlockState(pos.down()).isSolidBlock(world, pos.down())) {
				return pos;
			}
		}
		return null;
	}

	// ------------------------------------------------------------------
	// Hunting villagers out of jealousy
	// ------------------------------------------------------------------

	private void beginVillagerHunt(LobberEntity lob, ServerWorld world) {
		BlockPos center = this.home != null ? this.home : lob.getBlockPos();
		List<VillagerEntity> villagers = world.getEntitiesByClass(VillagerEntity.class,
				new Box(center).expand(32.0), v -> v.isAlive());
		if (villagers.isEmpty()) {
			return;
		}
		this.eventEntity = villagers.get(lob.getRandom().nextInt(villagers.size()));
		this.eventTimer = 240;
		this.activeEvent = EVENT_VILLAGER;
	}

	private void tickVillagerHunt(LobberEntity lob, ServerWorld world) {
		if (this.eventEntity == null || !this.eventEntity.isAlive() || --this.eventTimer <= 0) {
			this.endEvent();
			return;
		}
		lob.getNavigation().startMovingTo(this.eventEntity, 1.25);
		lob.getLookControl().lookAt(this.eventEntity, 30.0f, 30.0f);
		if (lob.squaredDistanceTo(this.eventEntity) < 4.0) {
			this.eventEntity.damage(world.getDamageSources().mobAttack(lob), 14.0f);
			world.playSound(null, this.eventEntity.getBlockPos(), SoundEvents.ENTITY_ENDERMAN_STARE,
					SoundCategory.HOSTILE, 0.8f, 0.7f);
			if (!this.eventEntity.isAlive()) {
				this.endEvent();
			}
		}
	}

	// ------------------------------------------------------------------
	// Helpers + persistence
	// ------------------------------------------------------------------

	private static BlockPos findNearest(ServerWorld world, BlockPos center, int radius, Predicate<Block> predicate) {
		BlockPos best = null;
		double bestDistance = Double.MAX_VALUE;
		for (BlockPos pos : BlockPos.iterate(
				center.add(-radius, -4, -radius), center.add(radius, 4, radius))) {
			if (predicate.test(world.getBlockState(pos).getBlock())) {
				double distance = pos.getSquaredDistance(center);
				if (distance < bestDistance) {
					bestDistance = distance;
					best = pos.toImmutable();
				}
			}
		}
		return best;
	}

	public void writeNbt(NbtCompound nbt) {
		nbt.putInt("EventCooldown", this.cooldown);
		if (this.home != null) {
			nbt.putBoolean("HasHome", true);
			nbt.putInt("HomeX", this.home.getX());
			nbt.putInt("HomeY", this.home.getY());
			nbt.putInt("HomeZ", this.home.getZ());
		}
	}

	public void readNbt(NbtCompound nbt) {
		if (nbt.contains("EventCooldown")) {
			this.cooldown = nbt.getInt("EventCooldown");
		}
		if (nbt.getBoolean("HasHome")) {
			this.home = new BlockPos(nbt.getInt("HomeX"), nbt.getInt("HomeY"), nbt.getInt("HomeZ"));
		}
	}
}
