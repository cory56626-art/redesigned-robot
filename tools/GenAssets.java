import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

/**
 * Procedurally generates the Marauder's entity skins, item textures and item
 * model JSON files. Run once with: java GenAssets.java <resourcesRoot>
 */
public class GenAssets {

    static String ASSETS;

    public static void main(String[] args) throws IOException {
        String root = args.length > 0 ? args[0] : "src/main/resources";
        ASSETS = root + "/assets/marauder";
        new File(ASSETS + "/textures/entity").mkdirs();
        new File(ASSETS + "/textures/item").mkdirs();
        new File(ASSETS + "/models/item").mkdirs();

        for (int stage = 1; stage <= 10; stage++) {
            genSkin(stage);
        }

        // Progression materials (item/generated).
        genGem("dark_scrap", 0x3C3C42, 0x202024);
        genGem("blacksteel_fragment", 0x2D303A, 0x15161C);
        genGem("ashen_shard", 0x78645A, 0x3A302B);
        genGem("moon_shard", 0x96AAD2, 0x5A6E96);
        genGem("rune_fragment", 0x785AB4, 0x3C2D64);
        genGem("abyss_fragment", 0x281438, 0x0A0414);
        genGem("unbroken_core", 0x50505A, 0x28282E);
        genRemnant("ashen_remnant");
        genTrophy("marauder_trophy");
        genBlade("blacksteel_blade");

        // Item models.
        String[] generated = {"dark_scrap", "blacksteel_fragment", "ashen_shard", "moon_shard",
                "rune_fragment", "abyss_fragment", "unbroken_core", "marauder_trophy", "ashen_remnant"};
        for (String n : generated) {
            writeModel(n, "minecraft:item/generated");
        }
        writeModel("blacksteel_blade", "minecraft:item/handheld");

        System.out.println("Assets generated under " + ASSETS);
    }

    // ---- entity skins (128x128, charred/molten flame knight) -----------

    static void genSkin(int stage) throws IOException {
        int S = 128;
        BufferedImage img = new BufferedImage(S, S, BufferedImage.TYPE_INT_ARGB);
        java.util.Random rng = new java.util.Random(1000L + stage);

        // Molten intensity climbs across the ten nights: dark rusted knight -> radiant.
        double heat = 0.10 + (stage - 1) * 0.085; // 0.10 .. 0.87
        int moltenColor = mix(0x7A1E0A, 0xE0662B, Math.min(1.0, heat + 0.1));
        int hotColor = mix(0xE0662B, 0xFFE39A, Math.min(1.0, heat));

        for (int y = 0; y < S; y++) {
            for (int x = 0; x < S; x++) {
                // Charred blackened plate base with subtle plate banding and noise.
                int n = rng.nextInt(14);
                int band = ((y / 6) % 2 == 0) ? 4 : 0;
                int base = 0x121319;
                int v = 0x12 + n + band;
                int c = (v << 16) | ((v + 1) << 8) | (v + 4);
                // A little cool blue-steel sheen on some plates.
                if (rng.nextInt(9) == 0) c = mix(c, 0x2A3340, 0.5);
                img.setRGB(x, y, 0xFF000000 | (c & 0xFFFFFF));
            }
        }

        // Molten cracks: short branching bright veins, denser and hotter with stage.
        int veins = 20 + stage * 10;
        for (int i = 0; i < veins; i++) {
            int x = rng.nextInt(S);
            int y = rng.nextInt(S);
            int len = 3 + rng.nextInt(8);
            int dx = rng.nextInt(3) - 1;
            int dy = rng.nextInt(3) - 1;
            if (dx == 0 && dy == 0) dy = 1;
            for (int s = 0; s < len; s++) {
                if (x < 0 || y < 0 || x >= S || y >= S) break;
                boolean hot = rng.nextDouble() < heat;
                img.setRGB(x, y, 0xFF000000 | ((hot ? hotColor : moltenColor) & 0xFFFFFF));
                // occasional glow halo pixel
                if (rng.nextInt(4) == 0 && x + 1 < S) {
                    img.setRGB(x + 1, y, 0xFF000000 | mix(moltenColor, base(), 0.4));
                }
                x += dx + (rng.nextInt(3) - 1);
                y += dy;
            }
        }

        // Ember pool along the lower body (skirt/legs region of the atlas).
        for (int i = 0; i < 30 + stage * 6; i++) {
            int x = rng.nextInt(S);
            int y = 60 + rng.nextInt(60);
            if (y >= S) continue;
            img.setRGB(x, y, 0xFF000000 | mix(moltenColor, 0x140805, rng.nextDouble()));
        }

        // Glowing eye slits region (head atlas around uv 32..64, 0..24).
        int eye = mix(0xE0662B, 0xFFF0C0, heat);
        for (int x = 40; x < 46; x++) img.setRGB(x, 12, 0xFF000000 | eye);
        for (int x = 52; x < 58; x++) img.setRGB(x, 12, 0xFF000000 | eye);

        // Crown/halo glow accents baked near their atlas rows for stages that show them.
        if (stage >= 4) {
            for (int x = 0; x < 30; x++) img.setRGB(x, 41, 0xFF000000 | mix(0xE0662B, 0xFFE39A, heat));
        }
        if (stage >= 6) {
            for (int x = 40; x < 104; x++) img.setRGB(x, 41, 0xFF000000 | mix(0xFFC24B, 0xFFF6D8, heat));
        }

        ImageIO.write(img, "PNG", new File(ASSETS + "/textures/entity/marauder_" + stage + ".png"));
    }

    static int base() {
        return 0x121319;
    }

    // ---- item textures (16x16) -----------------------------------------

    static void genGem(String name, int color, int outline) throws IOException {
        BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < 16; y++) {
            for (int x = 0; x < 16; x++) {
                int dx = Math.abs(x - 8);
                int dy = Math.abs(y - 8);
                if (dx + dy <= 6) {
                    int c = (dx + dy >= 6) ? outline : color;
                    // simple top-left highlight
                    if (x + y < 12) c = mix(c, 0xFFFFFF, 0.35);
                    img.setRGB(x, y, 0xFF000000 | (c & 0xFFFFFF));
                }
            }
        }
        ImageIO.write(img, "PNG", new File(ASSETS + "/textures/item/" + name + ".png"));
    }

    static void genRemnant(String name) throws IOException {
        BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < 16; y++) {
            for (int x = 0; x < 16; x++) {
                int dx = Math.abs(x - 8);
                int dy = Math.abs(y - 8);
                if (dx + dy <= 6) {
                    int base = 0x6E6960;
                    if (((x * 3 + y * 5) % 7) == 0) base = 0xC9BFB0;
                    if (((x + y) % 5) == 0) base = 0x3A362F;
                    img.setRGB(x, y, 0xFF000000 | base);
                }
            }
        }
        ImageIO.write(img, "PNG", new File(ASSETS + "/textures/item/" + name + ".png"));
    }

    static void genTrophy(String name) throws IOException {
        BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        // pole
        for (int y = 1; y < 15; y++) img.setRGB(3, y, 0xFF3A2E22);
        // banner cloth
        for (int y = 2; y < 12; y++) {
            for (int x = 4; x < 13; x++) {
                int c = 0x1E1E23;
                if (x == 12) c = 0x0A0A0C;
                img.setRGB(x, y, 0xFF000000 | c);
            }
        }
        // red emblem
        for (int y = 4; y < 9; y++) img.setRGB(8, y, 0xFFC0392B);
        for (int x = 6; x < 11; x++) img.setRGB(x, 6, 0xFFC0392B);
        ImageIO.write(img, "PNG", new File(ASSETS + "/textures/item/" + name + ".png"));
    }

    static void genBlade(String name) throws IOException {
        BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        // diagonal blade from bottom-left to top-right
        for (int i = 0; i < 11; i++) {
            int x = 3 + i;
            int y = 12 - i;
            img.setRGB(x, y, 0xFF46505A);
            if (x + 1 < 16) img.setRGB(x + 1, y, 0xFF6E7A8C);
            if (y - 1 >= 0) img.setRGB(x, y - 1, 0xFF9AA6B8);
        }
        // cursed glow edge
        img.setRGB(13, 2, 0xFF9B59B6);
        img.setRGB(14, 1, 0xFFBE7BE0);
        // guard
        img.setRGB(3, 12, 0xFF2A2A30);
        img.setRGB(4, 13, 0xFF2A2A30);
        img.setRGB(2, 13, 0xFF2A2A30);
        // handle
        img.setRGB(2, 14, 0xFF40342A);
        img.setRGB(1, 15, 0xFF40342A);
        ImageIO.write(img, "PNG", new File(ASSETS + "/textures/item/" + name + ".png"));
    }

    // ---- models ---------------------------------------------------------

    static void writeModel(String name, String parent) throws IOException {
        String json = "{\n  \"parent\": \"" + parent + "\",\n  \"textures\": {\n    \"layer0\": \"marauder:item/"
                + name + "\"\n  }\n}\n";
        try (FileWriter w = new FileWriter(ASSETS + "/models/item/" + name + ".json")) {
            w.write(json);
        }
    }

    // ---- helpers --------------------------------------------------------

    static void fill(BufferedImage img, int x0, int y0, int w, int h, int rgb) {
        for (int y = y0; y < y0 + h; y++) {
            for (int x = x0; x < x0 + w; x++) {
                img.setRGB(x, y, 0xFF000000 | (rgb & 0xFFFFFF));
            }
        }
    }

    static int brighten(int rgb, int amount) {
        int r = Math.min(255, ((rgb >> 16) & 0xFF) + amount);
        int g = Math.min(255, ((rgb >> 8) & 0xFF) + amount);
        int b = Math.min(255, (rgb & 0xFF) + amount);
        return (r << 16) | (g << 8) | b;
    }

    static int mix(int a, int b, double t) {
        int ar = (a >> 16) & 0xFF, ag = (a >> 8) & 0xFF, ab = a & 0xFF;
        int br = (b >> 16) & 0xFF, bg = (b >> 8) & 0xFF, bb = b & 0xFF;
        int r = (int) (ar + (br - ar) * t);
        int g = (int) (ag + (bg - ag) * t);
        int bl = (int) (ab + (bb - ab) * t);
        return (r << 16) | (g << 8) | bl;
    }
}
