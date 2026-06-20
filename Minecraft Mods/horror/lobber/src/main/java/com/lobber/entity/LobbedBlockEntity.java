package com.lobber.entity;

import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.projectile.thrown.ThrownItemEntity;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.world.World;

/**
 * The block a Lobber hurls. Damage scales with how tough the thrown block is, so an
 * iron block hits far harder than a plank.
 */
public class LobbedBlockEntity extends ThrownItemEntity {

	public LobbedBlockEntity(EntityType<? extends LobbedBlockEntity> entityType, World world) {
		super(entityType, world);
	}

	public LobbedBlockEntity(World world, LivingEntity owner, ItemStack stack) {
		super(ModEntities.LOBBED_BLOCK, owner, world);
		this.setItem(stack.isEmpty() ? new ItemStack(this.getDefaultItem()) : stack);
	}

	@Override
	protected Item getDefaultItem() {
		return Items.COBBLESTONE;
	}

	/** Tougher blocks deal more damage; capped so obsidian doesn't one-shot you. */
	public float computeDamage() {
		Item item = this.getStack().getItem();
		float hardness = 1.0f;
		if (item instanceof BlockItem blockItem) {
			hardness = blockItem.getBlock().getHardness();
		}
		if (hardness < 0.0f) {
			hardness = 1.0f;
		}
		hardness = Math.min(hardness, 6.0f);
		return 2.0f + hardness * 1.4f;
	}

	@Override
	protected void onEntityHit(EntityHitResult entityHitResult) {
		super.onEntityHit(entityHitResult);
		Entity hit = entityHitResult.getEntity();
		Entity owner = this.getOwner();
		LivingEntity attacker = owner instanceof LivingEntity ? (LivingEntity) owner : null;
		DamageSource source = this.getDamageSources().mobProjectile(this, attacker);
		hit.damage(source, this.computeDamage());
	}

	@Override
	protected void onCollision(HitResult hitResult) {
		// Status 3 makes vanilla spawn the item-break particles of our thrown block.
		if (!this.getWorld().isClient) {
			this.getWorld().sendEntityStatus(this, (byte) 3);
		}
		super.onCollision(hitResult);
	}
}
