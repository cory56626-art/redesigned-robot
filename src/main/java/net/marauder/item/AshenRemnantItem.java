package net.marauder.item;

import net.marauder.state.MarauderState;
import net.marauder.state.PlayerProgress;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.client.item.TooltipContext;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.TypedActionResult;
import net.minecraft.util.Rarity;
import net.minecraft.world.World;

import java.util.List;

/**
 * Ashen Remnant — a rare item, left only after the ten-night rivalry ends, that
 * lets the player deliberately re-summon the completed Marauder for a rematch.
 */
public class AshenRemnantItem extends Item {

    public AshenRemnantItem(Settings settings) {
        super(settings);
    }

    @Override
    public TypedActionResult<ItemStack> use(World world, PlayerEntity user, Hand hand) {
        ItemStack stack = user.getStackInHand(hand);
        if (world.isClient || !(user instanceof ServerPlayerEntity player)) {
            return TypedActionResult.success(stack, world.isClient);
        }

        MarauderState state = MarauderState.get(player.getServer());
        PlayerProgress progress = state.getOrCreate(player.getUuid());

        if (!progress.finalComplete) {
            player.sendMessage(Text.literal("The remnant is cold. The rivalry is not yet finished.")
                    .formatted(Formatting.GRAY), true);
            return TypedActionResult.fail(stack);
        }

        progress.rematchUnlocked = true;
        progress.rematchArmed = true;
        progress.stage = 10;
        state.markDirty();

        world.playSound(null, player.getBlockPos(), SoundEvents.BLOCK_SOUL_SAND_BREAK, SoundCategory.PLAYERS, 1.0f, 0.5f);
        player.sendMessage(Text.literal("The ash stirs. The Marauder will answer on the next night.")
                .formatted(Formatting.DARK_PURPLE), false);

        if (!player.getAbilities().creativeMode) {
            stack.decrement(1);
        }
        return TypedActionResult.success(stack, false);
    }

    @Override
    public void appendTooltip(ItemStack stack, World world, List<Text> tooltip, TooltipContext context) {
        tooltip.add(Text.translatable("item.marauder.ashen_remnant.tip").formatted(Formatting.DARK_GRAY, Formatting.ITALIC));
        super.appendTooltip(stack, world, tooltip, context);
    }
}
