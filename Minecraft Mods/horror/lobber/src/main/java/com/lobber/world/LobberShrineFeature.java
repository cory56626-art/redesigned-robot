package com.lobber.world;

import com.mojang.serialization.Codec;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.ChestBlockEntity;
import net.minecraft.block.entity.MobSpawnerBlockEntity;
import net.minecraft.entity.EntityType;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.random.Random;
import net.minecraft.world.StructureWorldAccess;
import net.minecraft.world.gen.feature.DefaultFeatureConfig;
import net.minecraft.world.gen.feature.Feature;
import net.minecraft.world.gen.feature.util.FeatureContext;

/**
 * A small, hand-built shrine that generates in the dark underground: a cramped tomb of cracked
 * deepslate bricks and cobwebs, watched over by a skeleton spawner, holding bones, skulls, and a
 * journal page describing the Lobber.
 */
public class LobberShrineFeature extends Feature<DefaultFeatureConfig> {

	public LobberShrineFeature(Codec<DefaultFeatureConfig> codec) {
		super(codec);
	}

	@Override
	public boolean generate(FeatureContext<DefaultFeatureConfig> context) {
		StructureWorldAccess world = context.getWorld();
		BlockPos origin = context.getOrigin();
		Random random = context.getRandom();

		// Only carve into reasonably solid ground so the shrine doesn't dangle in an open cave.
		if (!isBuriedEnough(world, origin)) {
			return false;
		}

		int rx = 3; // half-width
		int rz = 3;
		int height = 4;

		// Shell + hollow interior.
		for (int dx = -rx; dx <= rx; dx++) {
			for (int dz = -rz; dz <= rz; dz++) {
				for (int dy = 0; dy <= height; dy++) {
					BlockPos pos = origin.add(dx, dy, dz);
					boolean shell = dx == -rx || dx == rx || dz == -rz || dz == rz || dy == 0 || dy == height;
					if (shell) {
						this.setBlockState(world, pos, pickBrick(random));
					} else {
						this.setBlockState(world, pos, Blocks.CAVE_AIR.getDefaultState());
					}
				}
			}
		}

		// Cobwebs scattered in the interior.
		for (int i = 0; i < 10; i++) {
			BlockPos web = origin.add(
					random.nextInt(rx * 2 - 1) - (rx - 1),
					1 + random.nextInt(height - 1),
					random.nextInt(rz * 2 - 1) - (rz - 1));
			if (world.getBlockState(web).isAir()) {
				this.setBlockState(world, web, Blocks.COBWEB.getDefaultState());
			}
		}

		// Skulls on the floor.
		for (int i = 0; i < 3; i++) {
			BlockPos floor = origin.add(
					random.nextInt(rx * 2 - 1) - (rx - 1),
					1,
					random.nextInt(rz * 2 - 1) - (rz - 1));
			if (world.getBlockState(floor).isAir()) {
				this.setBlockState(world, floor, Blocks.SKELETON_SKULL.getDefaultState());
			}
		}

		// A skeleton spawner in a corner so the mines stay dangerous.
		BlockPos spawnerPos = origin.add(rx - 1, 1, rz - 1);
		this.setBlockState(world, spawnerPos, Blocks.SPAWNER.getDefaultState());
		BlockEntity spawnerBe = world.getBlockEntity(spawnerPos);
		if (spawnerBe instanceof MobSpawnerBlockEntity spawner) {
			spawner.setEntityType(EntityType.SKELETON, random);
			spawner.markDirty();
		}

		// A chest with the lore book and a few grim trophies.
		BlockPos chestPos = origin.add(0, 1, 0);
		this.setBlockState(world, chestPos, Blocks.CHEST.getDefaultState());
		BlockEntity chestBe = world.getBlockEntity(chestPos);
		if (chestBe instanceof ChestBlockEntity chest) {
			chest.setStack(13, LobberLore.createLoreBook(random));
			chest.setStack(0, new net.minecraft.item.ItemStack(net.minecraft.item.Items.BONE, 2 + random.nextInt(4)));
			chest.setStack(26, new net.minecraft.item.ItemStack(net.minecraft.item.Items.ENDER_PEARL, 1 + random.nextInt(2)));
			chest.markDirty();
		}

		return true;
	}

	private static boolean isBuriedEnough(StructureWorldAccess world, BlockPos origin) {
		int solid = 0;
		int sampled = 0;
		for (int dx = -3; dx <= 3; dx += 3) {
			for (int dy = -1; dy <= 4; dy += 5) {
				for (int dz = -3; dz <= 3; dz += 3) {
					sampled++;
					if (world.getBlockState(origin.add(dx, dy, dz)).isSolidBlock(world, origin.add(dx, dy, dz))) {
						solid++;
					}
				}
			}
		}
		return solid >= sampled * 3 / 4;
	}

	private static net.minecraft.block.BlockState pickBrick(Random random) {
		Block block = switch (random.nextInt(5)) {
			case 0, 1 -> Blocks.CRACKED_DEEPSLATE_BRICKS;
			case 2 -> Blocks.DEEPSLATE_TILES;
			case 3 -> Blocks.MOSSY_STONE_BRICKS;
			default -> Blocks.DEEPSLATE_BRICKS;
		};
		return block.getDefaultState();
	}
}
