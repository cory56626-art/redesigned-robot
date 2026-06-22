package com.lobber.client;

import com.lobber.entity.LobberEntity;
import com.lobber.network.LobberNetworking;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PacketByteBufs;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.network.PacketByteBuf;
import net.minecraft.screen.ScreenTexts;
import net.minecraft.text.Text;

/**
 * Relationship + worker panel shown when you press the info key near a befriended Lobber.
 * Reads health/age/trust straight off the (synced) entity; worker controls are sent to the server.
 */
public class LobberInfoScreen extends Screen {
	private final LobberEntity lobber;

	public LobberInfoScreen(LobberEntity lobber) {
		super(Text.translatable("screen.lobber.info"));
		this.lobber = lobber;
	}

	@Override
	protected void init() {
		if (this.lobber.isWorker()) {
			int cx = this.width / 2;
			int row = this.height / 2 + 28;
			this.addDrawableChild(workButton(cx - 122, row, "Ores", LobberEntity.WORK_ORES));
			this.addDrawableChild(workButton(cx - 40, row, "Wood", LobberEntity.WORK_WOOD));
			this.addDrawableChild(workButton(cx + 42, row, "Stone", LobberEntity.WORK_STONE));

			this.addDrawableChild(ButtonWidget.builder(Text.literal("Collect haul"),
							b -> this.send(LobberNetworking.ACTION_COLLECT, 0))
					.dimensions(cx - 122, row + 24, 120, 20).build());
			this.addDrawableChild(ButtonWidget.builder(Text.literal("Take tool back"),
							b -> this.send(LobberNetworking.ACTION_TAKE_TOOL, 0))
					.dimensions(cx + 2, row + 24, 120, 20).build());
		}

		this.addDrawableChild(ButtonWidget.builder(ScreenTexts.DONE, button -> this.close())
				.dimensions(this.width / 2 - 50, this.height / 2 + 86, 100, 20)
				.build());
	}

	private ButtonWidget workButton(int x, int y, String label, int workType) {
		return ButtonWidget.builder(Text.literal(label), b -> this.send(LobberNetworking.ACTION_SET_WORK, workType))
				.dimensions(x, y, 80, 20)
				.build();
	}

	private void send(int action, int value) {
		PacketByteBuf buf = PacketByteBufs.create();
		buf.writeInt(this.lobber.getId());
		buf.writeInt(action);
		buf.writeInt(value);
		ClientPlayNetworking.send(LobberNetworking.ACTION, buf);
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float delta) {
		this.renderBackground(context);

		int cx = this.width / 2;
		int top = this.height / 2 - 86;

		context.drawCenteredTextWithShadow(this.textRenderer, this.title, cx, top, 0xFFFFFF);

		String stage = this.lobber.isMature() ? "Mature" : (this.lobber.isFriendly() ? "Young (your friend)" : "Young");
		if (this.lobber.isWorker()) {
			stage += " - helper [" + workTypeName(this.lobber.getWorkType()) + "]";
		}
		context.drawCenteredTextWithShadow(this.textRenderer, Text.literal("§7" + stage), cx, top + 14, 0xAAAAAA);

		this.drawStat(context, cx, top + 38, "Health", this.lobber.getHealth(), this.lobber.getMaxHealth(), 0xFF5555);
		this.drawStat(context, cx, top + 64, "Age", this.lobber.getGrowth(), 100, 0x77DD55);
		this.drawStat(context, cx, top + 90, "Trust", this.lobber.getTrust(), LobberEntity.MAX_TRUST, 0xFFB033);

		super.render(context, mouseX, mouseY, delta);
	}

	private static String workTypeName(int type) {
		return switch (type) {
			case LobberEntity.WORK_ORES -> "Ores";
			case LobberEntity.WORK_WOOD -> "Wood";
			case LobberEntity.WORK_STONE -> "Stone";
			default -> "Idle";
		};
	}

	private void drawStat(DrawContext context, int cx, int y, String label, float value, float max, int color) {
		int barWidth = 180;
		int x = cx - barWidth / 2;
		context.drawTextWithShadow(this.textRenderer,
				label + ": " + (int) value + " / " + (int) max, x, y - 10, 0xFFFFFF);
		context.fill(x, y, x + barWidth, y + 8, 0xFF333333);
		// Trust can be negative; clamp the bar to [0, max] for display.
		float shown = Math.max(0.0f, value);
		int filled = max <= 0 ? 0 : (int) (barWidth * Math.min(1.0f, shown / max));
		context.fill(x, y, x + filled, y + 8, 0xFF000000 | color);
	}

	@Override
	public boolean shouldPause() {
		return false;
	}
}
