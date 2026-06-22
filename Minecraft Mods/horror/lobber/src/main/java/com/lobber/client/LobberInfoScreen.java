package com.lobber.client;

import com.lobber.entity.LobberEntity;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.screen.ScreenTexts;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

/**
 * The little relationship panel shown when you press the info key near a Lobber you've befriended.
 * Reads health/age/trust straight off the (synced) entity, so no networking is needed.
 */
public class LobberInfoScreen extends Screen {
	private final LobberEntity lobber;

	public LobberInfoScreen(LobberEntity lobber) {
		super(Text.translatable("screen.lobber.info"));
		this.lobber = lobber;
	}

	@Override
	protected void init() {
		this.addDrawableChild(ButtonWidget.builder(ScreenTexts.DONE, button -> this.close())
				.dimensions(this.width / 2 - 50, this.height / 2 + 60, 100, 20)
				.build());
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float delta) {
		this.renderBackground(context);

		int cx = this.width / 2;
		int top = this.height / 2 - 70;

		context.drawCenteredTextWithShadow(this.textRenderer, this.title, cx, top, 0xFFFFFF);

		String stage = this.lobber.isMature()
				? (this.lobber.isFriendly() ? "Mature §o(still fond of you)" : "Mature")
				: (this.lobber.isFriendly() ? "Young §o(your friend)" : "Young");
		context.drawCenteredTextWithShadow(this.textRenderer,
				Text.literal("§7" + stage), cx, top + 14, 0xAAAAAA);

		this.drawStat(context, cx, top + 40, "Health", this.lobber.getHealth(), this.lobber.getMaxHealth(), 0xFF5555);
		this.drawStat(context, cx, top + 70, "Age", this.lobber.getGrowth(), 100, 0x77DD55);
		this.drawStat(context, cx, top + 100, "Trust", this.lobber.getTrust(), LobberEntity.MAX_TRUST, 0xFFB033);

		super.render(context, mouseX, mouseY, delta);
	}

	private void drawStat(DrawContext context, int cx, int y, String label, float value, float max, int color) {
		int barWidth = 180;
		int x = cx - barWidth / 2;
		context.drawTextWithShadow(this.textRenderer,
				label + ": " + (int) value + " / " + (int) max, x, y - 10, 0xFFFFFF);
		context.fill(x, y, x + barWidth, y + 8, 0xFF333333);
		int filled = max <= 0 ? 0 : (int) (barWidth * Math.min(1.0f, value / max));
		context.fill(x, y, x + filled, y + 8, 0xFF000000 | color);
	}

	@Override
	public boolean shouldPause() {
		return false;
	}
}
