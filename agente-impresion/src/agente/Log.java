package agente;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;

/** Log diario en logs/agente-AAAA-MM-DD.log; borra los archivos más viejos que log.dias. */
public final class Log {
    private static File carpeta;

    private Log() {}

    static void iniciar(File base, int dias) {
        carpeta = new File(base, "logs");
        carpeta.mkdirs();
        long limite = System.currentTimeMillis() - dias * 86_400_000L;
        File[] viejos = carpeta.listFiles((d, n) -> n.startsWith("agente-") && n.endsWith(".log"));
        if (viejos != null) for (File f : viejos) if (f.lastModified() < limite) f.delete();
    }

    public static void info(String mensaje) { escribir("INFO ", mensaje); }
    public static void error(String mensaje) { escribir("ERROR", mensaje); }

    private static synchronized void escribir(String nivel, String mensaje) {
        String linea = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()) + " " + nivel + " " + mensaje;
        System.out.println(linea);
        if (carpeta == null) return;
        File f = new File(carpeta, "agente-" + new SimpleDateFormat("yyyy-MM-dd").format(new Date()) + ".log");
        try (Writer w = new OutputStreamWriter(new FileOutputStream(f, true), StandardCharsets.UTF_8)) {
            w.write(linea + "\r\n");
        } catch (IOException ignored) {
            // Sin log en disco no se detiene la impresión.
        }
    }
}
