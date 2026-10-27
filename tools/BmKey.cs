// Magenta chroma-key matte, ported from tools/buang-magenta.html (bmCore).
// Used by shrink-assets.ps1 through Add-Type (C# 5, .NET Framework) so pixels are processed fast.
// Pixel buffers are GDI+ Format32bppArgb byte order: B, G, R, A.
using System;
using System.Collections.Generic;

public static class BmKey
{
    static double Cb(double r, double g, double b) { return -0.168736 * r - 0.331264 * g + 0.5 * b; }
    static double Cr(double r, double g, double b) { return 0.5 * r - 0.418688 * g - 0.081312 * b; }

    // Median magenta colour of the image border, or null when the border is not magenta
    // (already transparent, or a full background picture).
    public static int[] DetectKey(byte[] px, int w, int h)
    {
        List<int> rs = new List<int>(), gs = new List<int>(), bs = new List<int>();
        int step = Math.Max(1, (w + h) / 400);
        for (int x = 0; x < w; x += step) { Take(px, x, rs, gs, bs); Take(px, (h - 1) * w + x, rs, gs, bs); }
        for (int y = 0; y < h; y += step) { Take(px, y * w, rs, gs, bs); Take(px, y * w + w - 1, rs, gs, bs); }
        if (rs.Count < 8) return null;
        rs.Sort(); gs.Sort(); bs.Sort();
        int m = rs.Count / 2;
        return new int[] { rs[m], gs[m], bs[m] };
    }
    static void Take(byte[] px, int i, List<int> rs, List<int> gs, List<int> bs)
    {
        int p = i * 4, b = px[p], g = px[p + 1], r = px[p + 2], a = px[p + 3];
        if (a > 200 && r > 120 && b > 120 && g < Math.Min(r, b) * 0.6) { rs.Add(r); gs.Add(g); bs.Add(b); }
    }

    // Removes the magenta background in place. Returns the number of pixels made fully transparent.
    public static int Run(byte[] px, int w, int h, int[] K, double lo, double hi, double strict,
                          double despill, double choke, int speck, bool holes, int minHole, bool denoise)
    {
        int N = w * h;
        // 1. similarity: projection of the pixel's chroma on the key's chroma, penalised when off-axis
        double kx = Cb(K[0], K[1], K[2]), ky = Cr(K[0], K[1], K[2]), kk = kx * kx + ky * ky;
        if (kk < 1) kk = 1;
        double kl = Math.Sqrt(kk);
        float[] sim = new float[N];
        for (int i = 0, p = 0; i < N; i++, p += 4)
        {
            double r = px[p + 2], g = px[p + 1], b = px[p];
            double x = Cb(r, g, b), y = Cr(r, g, b), t = (x * kx + y * ky) / kk;
            double ex = x - t * kx, ey = y - t * ky, perp = Math.Sqrt(ex * ex + ey * ey) / kl;
            sim[i] = (float)((t - perp * 1.5) * (px[p + 3] / 255.0));
        }
        // 2. 3x3 median on the similarity map only (JPEG noise / gradients); sharp edges keep their value
        if (denoise)
        {
            float[] s2 = new float[N], win = new float[9];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int n = 0;
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        int yy = Math.Min(h - 1, Math.Max(0, y + dy));
                        for (int dx = -1; dx <= 1; dx++) { int xx = Math.Min(w - 1, Math.Max(0, x + dx)); win[n++] = sim[yy * w + xx]; }
                    }
                    Array.Sort(win); s2[y * w + x] = win[4];
                }
            for (int i = 0; i < N; i++) if (Math.Abs(s2[i] - sim[i]) < 0.25f) sim[i] = s2[i];
        }
        // 3. background = region connected to the image border (8-way) + enclosed pure-key holes
        float FILL = (float)((lo + hi) / 2);
        byte[] bg = new byte[N];
        int[] stack = new int[N];
        int sp = 0;
        for (int x = 0; x < w; x++) { Seed(x, sim, bg, stack, ref sp, FILL); Seed((h - 1) * w + x, sim, bg, stack, ref sp, FILL); }
        for (int y = 0; y < h; y++) { Seed(y * w, sim, bg, stack, ref sp, FILL); Seed(y * w + w - 1, sim, bg, stack, ref sp, FILL); }
        Flood(w, h, sim, bg, stack, ref sp, FILL);
        if (holes)
        {
            byte[] seen = new byte[N];
            int[] comp = new int[N];
            for (int s = 0; s < N; s++)
            {
                if (seen[s] != 0 || bg[s] != 0 || sim[s] < strict) continue;
                int n = 0, q = 0; comp[n++] = s; seen[s] = 1;
                while (q < n)
                {
                    int i = comp[q++], x = i % w, y = i / w;
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        int yy = y + dy; if (yy < 0 || yy >= h) continue;
                        for (int dx = -1; dx <= 1; dx++)
                        {
                            int xx = x + dx; if (xx < 0 || xx >= w) continue;
                            int j = yy * w + xx;
                            if (seen[j] == 0 && bg[j] == 0 && sim[j] >= strict) { seen[j] = 1; comp[n++] = j; }
                        }
                    }
                }
                if (n >= minHole) { for (int k = 0; k < n; k++) Seed(comp[k], sim, bg, stack, ref sp, FILL); Flood(w, h, sim, bg, stack, ref sp, FILL); }
            }
        }
        // 4. edge band: pixels within 3 px of the background
        byte[] band = new byte[N];
        {
            byte[] cur = (byte[])bg.Clone();
            for (int pass = 0; pass < 3; pass++)
            {
                byte[] nx = (byte[])cur.Clone();
                for (int i = 0; i < N; i++)
                {
                    if (cur[i] != 0) continue;
                    int x = i % w, y = i / w;
                    if ((x > 0 && cur[i - 1] != 0) || (x < w - 1 && cur[i + 1] != 0) || (y > 0 && cur[i - w] != 0) || (y < h - 1 && cur[i + w] != 0)) nx[i] = 1;
                }
                cur = nx;
            }
            for (int i = 0; i < N; i++) band[i] = (byte)(cur[i] != 0 && bg[i] == 0 ? 1 : 0);
        }
        // 5. soft alpha on background + edge band; object interior stays fully opaque
        float[] A = new float[N];
        double span = Math.Max(0.01, hi - lo);
        for (int i = 0; i < N; i++)
        {
            float a0 = px[i * 4 + 3] / 255f;
            if (bg[i] != 0 || band[i] != 0)
            {
                double v = 1 - Math.Min(1, Math.Max(0, (sim[i] - lo) / span));
                A[i] = (float)Math.Min(a0, v);
            }
            else A[i] = a0;
        }
        // 6. choke: whole pixels = alpha erosion in the band; fraction = trim faint edge haze only
        for (int n = (int)Math.Floor(choke); n > 0; n--) A = Erode(A, w, h, bg, band);
        double fr = choke - Math.Floor(choke);
        if (fr > 0)
        {
            float t = (float)(fr * 0.2);
            for (int i = 0; i < N; i++) if ((bg[i] != 0 || band[i] != 0) && A[i] < 1) A[i] = Math.Max(0, (A[i] - t) / (1 - t));
        }
        // 7. drop tiny isolated specks (components of visible pixels smaller than `speck`)
        if (speck > 0)
        {
            byte[] seen = new byte[N];
            int[] comp = new int[N];
            for (int s = 0; s < N; s++)
            {
                if (seen[s] != 0 || A[s] <= 0.1f) continue;
                int n = 0, q = 0; comp[n++] = s; seen[s] = 1;
                while (q < n)
                {
                    int i = comp[q++], x = i % w, y = i / w;
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        int yy = y + dy; if (yy < 0 || yy >= h) continue;
                        for (int dx = -1; dx <= 1; dx++)
                        {
                            int xx = x + dx; if (xx < 0 || xx >= w) continue;
                            int j = yy * w + xx;
                            if (seen[j] == 0 && A[j] > 0.1f) { seen[j] = 1; comp[n++] = j; }
                        }
                    }
                }
                if (n < speck) for (int k = 0; k < n; k++) { A[comp[k]] = 0; bg[comp[k]] = 1; }
            }
        }
        // 8. colour decontamination (un-mix the key), despill, and calm noisy faint edge pixels
        int cleared = 0;
        for (int i = 0, p = 0; i < N; i++, p += 4)
        {
            float a = A[i];
            if (a < 0.02f) { px[p] = px[p + 1] = px[p + 2] = px[p + 3] = 0; cleared++; continue; }
            if (bg[i] != 0 || band[i] != 0)
            {
                double r = px[p + 2], g = px[p + 1], b = px[p];
                if (a < 0.999f)
                {
                    r = Clamp((r - (1 - a) * K[0]) / a); g = Clamp((g - (1 - a) * K[1]) / a); b = Clamp((b - (1 - a) * K[2]) / a);
                }
                double m = Math.Min(r, b);
                if (m > g && despill > 0) { double e = (m - g) * despill; r -= e; b -= e; }
                if (a < 0.5f)
                {
                    double L = 0.299 * r + 0.587 * g + 0.114 * b, mix = (0.5 - a) * 1.6;
                    r += (L - r) * mix; g += (L - g) * mix; b += (L - b) * mix;
                }
                px[p + 2] = (byte)Clamp(r); px[p + 1] = (byte)Clamp(g); px[p] = (byte)Clamp(b);
            }
            px[p + 3] = (byte)Math.Round(a * 255);
        }
        return cleared;
    }

    static double Clamp(double v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
    static void Seed(int i, float[] sim, byte[] bg, int[] stack, ref int sp, float fill)
    {
        if (bg[i] == 0 && sim[i] > fill) { bg[i] = 1; stack[sp++] = i; }
    }
    static void Flood(int w, int h, float[] sim, byte[] bg, int[] stack, ref int sp, float fill)
    {
        while (sp > 0)
        {
            int i = stack[--sp], x = i % w, y = i / w;
            for (int dy = -1; dy <= 1; dy++)
            {
                int yy = y + dy; if (yy < 0 || yy >= h) continue;
                for (int dx = -1; dx <= 1; dx++)
                {
                    int xx = x + dx; if (xx < 0 || xx >= w) continue;
                    Seed(yy * w + xx, sim, bg, stack, ref sp, fill);
                }
            }
        }
    }
    static float[] Erode(float[] src, int w, int h, byte[] bg, byte[] band)
    {
        float[] d = (float[])src.Clone();
        for (int i = 0; i < src.Length; i++)
        {
            if (bg[i] == 0 && band[i] == 0) continue;
            int x = i % w, y = i / w; float m = src[i];
            for (int dy = -1; dy <= 1; dy++)
            {
                int yy = y + dy; if (yy < 0 || yy >= h) continue;
                for (int dx = -1; dx <= 1; dx++)
                {
                    int xx = x + dx; if (xx < 0 || xx >= w) continue;
                    float v = src[yy * w + xx]; if (v < m) m = v;
                }
            }
            d[i] = m;
        }
        return d;
    }
}
