import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
public class GenIcon {
  public static void main(String[] a) throws Exception {
    int S=128; BufferedImage img=new BufferedImage(S,S,BufferedImage.TYPE_INT_ARGB);
    for(int y=0;y<S;y++)for(int x=0;x<S;x++){
      double d=Math.hypot(x-64,y-64)/64.0;
      int base=(int)(30*(1-d));
      int rgb=(Math.max(0,base+8)<<16)|(Math.max(0,base+6)<<8)|Math.max(0,base+14);
      img.setRGB(x,y,0xFF000000|rgb);
    }
    // helmet silhouette
    for(int y=30;y<95;y++)for(int x=44;x<84;x++){
      double dx=(x-64)/20.0, dy=(y-60)/32.0;
      if(dx*dx+dy*dy<1.0) img.setRGB(x,y,0xFF181A20);
    }
    // eye slits (purple glow)
    for(int x=52;x<60;x++) img.setRGB(x,58,0xFF9B59B6);
    for(int x=68;x<76;x++) img.setRGB(x,58,0xFF9B59B6);
    ImageIO.write(img,"PNG",new File(a[0]));
    System.out.println("icon written");
  }
}
