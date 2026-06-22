package com.lobber.world;

import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtList;
import net.minecraft.nbt.NbtString;
import net.minecraft.util.math.random.Random;

/**
 * Builds the written books found in the underground shrines. Each book is a fragment of a
 * miner's journal documenting the thing that followed them home.
 */
public final class LobberLore {
	private LobberLore() {
	}

	private static final String[][] JOURNALS = {
			{
					"Day 1.\\n\\nFound odd tracks down here. Small. Like a child's, but the toes are wrong. Long. I keep hearing little laughs in the dark.",
					"Day 4.\\n\\nMy torches keep going out. This morning a single cobblestone was missing from my wall. Just one. Placed neatly on my bed.",
					"Day 9.\\n\\nIt has gotten BIGGER. I am sure of it. It does not run anymore when I turn. It just... grins. Green eyes. Always grinning.",
					"Day 12.\\n\\nIt knocked last night. Three times. I do not have a door down here.\\n\\n- do not look at it -"
			},
			{
					"They say it is born small and shy, a thief of trinkets and a breaker of nothing important.",
					"But it feeds on your attention. The more you see it, the bolder it grows, until the little goblin is a tall and hungry thing.",
					"It learns your home. It learns your animals. It learns the people you love.\\n\\nAnd then, out of love, it takes them from you.",
					"If your house burns while you are away, do not blame the creepers.\\n\\nIt was jealous."
			},
			{
					"Field notes - the Lobber",
					"Young: avoidant. Keeps its distance. Steals small things to play.",
					"Mature: malicious. Shatters glass to watch you flinch. Stares through windows while you sleep.",
					"There is only ever one. It is always YOURS. It will not share you."
			}
	};

	public static ItemStack createLoreBook(Random random) {
		String[] pages = JOURNALS[random.nextInt(JOURNALS.length)];
		ItemStack stack = new ItemStack(Items.WRITTEN_BOOK);
		NbtCompound nbt = stack.getOrCreateNbt();
		nbt.putString("title", "Miner's Last Journal");
		nbt.putString("author", "Unknown");
		nbt.putInt("generation", 2); // tattered copy
		NbtList pageList = new NbtList();
		for (String page : pages) {
			pageList.add(NbtString.of("{\"text\":\"" + page + "\"}"));
		}
		nbt.put("pages", pageList);
		return stack;
	}
}
