package net.marauder.item;

import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.SwordItem;
import net.minecraft.item.ToolMaterial;
import net.minecraft.recipe.Ingredient;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.world.World;

import java.util.List;

/**
 * The Marauder's Blacksteel Blade — the signature Night 10 reward.
 *
 * <p>Strong but not game-breaking: slightly above a netherite sword, with a
 * flavorful night-time curse. Under the open night sky it inflicts a short
 * Wither on the victim and siphons a little health back to the wielder.</p>
 */
public class BlacksteelBladeItem extends SwordItem {

    private static final ToolMaterial MATERIAL = new BlacksteelMaterial();

    public BlacksteelBladeItem(Item.Settings settings) {
        super(MATERIAL, 3, -2.4f, settings);
    }

    @Override
    public boolean postHit(ItemStack stack, LivingEntity target, LivingEntity attacker) {
        World world = attacker.getWorld();
        if (!world.isClient) {
            boolean night = world.isNight() && world.isSkyVisible(target.getBlockPos());
            if (night) {
                target.addStatusEffect(new StatusEffectInstance(StatusEffects.WITHER, 60, 0));
                attacker.heal(2.0f);
            }
        }
        return super.postHit(stack, target, attacker);
    }

    @Override
    public void appendTooltip(ItemStack stack, World world, List<Text> tooltip, net.minecraft.client.item.TooltipContext context) {
        tooltip.add(Text.translatable("item.marauder.blacksteel_blade.tip1").formatted(Formatting.DARK_GRAY, Formatting.ITALIC));
        tooltip.add(Text.translatable("item.marauder.blacksteel_blade.tip2").formatted(Formatting.DARK_PURPLE));
        super.appendTooltip(stack, world, tooltip, context);
    }

    private static final class BlacksteelMaterial implements ToolMaterial {
        @Override
        public int getDurability() {
            return 1561;
        }

        @Override
        public float getMiningSpeedMultiplier() {
            return 9.0f;
        }

        @Override
        public float getAttackDamage() {
            return 4.0f;
        }

        @Override
        public int getMiningLevel() {
            return 4;
        }

        @Override
        public int getEnchantability() {
            return 15;
        }

        @Override
        public Ingredient getRepairIngredient() {
            return Ingredient.ofItems(net.minecraft.item.Items.NETHERITE_INGOT);
        }
    }
}
