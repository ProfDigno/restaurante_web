package agente;

import org.apache.pdfbox.pdmodel.font.FontMappers;

import javax.swing.JOptionPane;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.net.BindException;
import java.net.InetAddress;
import java.net.URI;

/** Agente de impresión de Restaurante Web: recibe tickets PDF del navegador y los imprime sin diálogo en esta PC. */
public final class Agente {
    public static final String VERSION = "1.0.0";

    public static void main(String[] args) throws Exception {
        // instalar.bat lo usa para comprobar que el Java instalado puede correr el agente.
        if (args.length > 0 && args[0].equals("--version")) {
            System.out.println("Agente de impresión " + VERSION + " · Java " + System.getProperty("java.version") + " · PC " + equipo());
            return;
        }
        File base = carpetaBase();
        Config config = new Config(new File(base, "config.properties"));
        Log.iniciar(base, config.logDias());
        Log.info("Iniciando agente " + VERSION + " en " + equipo() + " (Java " + System.getProperty("java.version") + ")");
        Cola cola = new Cola(base, config);
        Servidor servidor;
        try {
            servidor = new Servidor(config, cola);
        } catch (BindException e) {
            String msg = "El puerto " + config.puerto() + " ya está en uso: el agente de impresión probablemente ya está abierto.";
            Log.error(msg);
            if (!GraphicsEnvironment.isHeadless()) JOptionPane.showMessageDialog(null, msg, "Agente de impresión", JOptionPane.WARNING_MESSAGE);
            System.exit(1);
            return;
        }
        // PDFBox arma su caché de fuentes la primera vez: se hace en segundo plano para que el primer ticket no demore.
        Thread calentar = new Thread(() -> { try { FontMappers.instance().getFontBoxFont("Helvetica", null); } catch (Throwable ignored) { } }, "fuentes");
        calentar.setDaemon(true);
        calentar.start();
        bandeja(servidor.puerto());
    }

    /** Nombre de la PC en Windows; identifica la terminal en el sistema. */
    public static String equipo() {
        String nombre = System.getenv("COMPUTERNAME");
        if (nombre == null || nombre.trim().isEmpty()) {
            try { nombre = InetAddress.getLocalHost().getHostName(); } catch (Exception e) { nombre = "PC"; }
        }
        return nombre.trim().toUpperCase();
    }

    private static File carpetaBase() {
        try {
            File jar = new File(Agente.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            return jar.isFile() ? jar.getParentFile() : new File(".").getAbsoluteFile();
        } catch (Exception e) {
            return new File(".").getAbsoluteFile();
        }
    }

    /** Ícono en la bandeja de Windows con acceso al panel y opción de salir. */
    private static void bandeja(int puerto) {
        if (GraphicsEnvironment.isHeadless() || !SystemTray.isSupported()) return;
        try {
            PopupMenu menu = new PopupMenu();
            MenuItem abrir = new MenuItem("Abrir panel");
            abrir.addActionListener(e -> abrirPanel(puerto));
            MenuItem salir = new MenuItem("Salir");
            salir.addActionListener(e -> {
                if (JOptionPane.showConfirmDialog(null, "Si cerrás el agente, los tickets se abrirán en el navegador.\n¿Cerrar el agente de impresión?",
                        "Agente de impresión", JOptionPane.YES_NO_OPTION) == JOptionPane.YES_OPTION) {
                    Log.info("Agente cerrado desde la bandeja");
                    System.exit(0);
                }
            });
            menu.add(abrir);
            menu.addSeparator();
            menu.add(salir);
            TrayIcon icono = new TrayIcon(iconoImpresora(), "Agente de impresión · " + equipo() + " · puerto " + puerto, menu);
            icono.setImageAutoSize(true);
            icono.addActionListener(e -> abrirPanel(puerto));
            SystemTray.getSystemTray().add(icono);
        } catch (Exception e) {
            Log.error("No se pudo crear el ícono de la bandeja: " + e.getMessage());
        }
    }

    private static void abrirPanel(int puerto) {
        try { Desktop.getDesktop().browse(new URI("http://127.0.0.1:" + puerto + "/")); } catch (Exception e) { Log.error("No se pudo abrir el panel: " + e.getMessage()); }
    }

    private static Image iconoImpresora() {
        BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(new Color(0xC7, 0x66, 0x48));
        g.fillRoundRect(1, 5, 14, 7, 3, 3);
        g.setColor(Color.WHITE);
        g.fillRect(4, 1, 8, 5);
        g.fillRect(4, 9, 8, 6);
        g.setColor(new Color(0x17, 0x20, 0x1F));
        g.drawRect(4, 1, 8, 4);
        g.drawRect(4, 9, 8, 6);
        g.drawLine(6, 11, 10, 11);
        g.drawLine(6, 13, 10, 13);
        g.dispose();
        return img;
    }
}
