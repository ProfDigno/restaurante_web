package agente;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.printing.PDFPrintable;
import org.apache.pdfbox.printing.Scaling;

import javax.print.PrintService;
import javax.print.PrintServiceLookup;
import javax.print.attribute.HashPrintRequestAttributeSet;
import javax.print.attribute.PrintRequestAttributeSet;
import javax.print.attribute.standard.JobName;
import java.awt.print.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Impresoras de Windows e impresión de PDF a tamaño real con PDFBox (sin diálogo). */
public final class Impresora {
    private Impresora() {}

    public static List<String> listar() {
        List<String> nombres = new ArrayList<>();
        for (PrintService s : PrintServiceLookup.lookupPrintServices(null, null)) nombres.add(s.getName());
        nombres.sort(String.CASE_INSENSITIVE_ORDER);
        return nombres;
    }

    public static String predeterminada() {
        PrintService s = PrintServiceLookup.lookupDefaultPrintService();
        return s == null ? "" : s.getName();
    }

    static PrintService buscar(String nombre) {
        if (nombre == null || nombre.trim().isEmpty()) return PrintServiceLookup.lookupDefaultPrintService();
        String buscado = nombre.trim().toLowerCase(Locale.ROOT);
        for (PrintService s : PrintServiceLookup.lookupPrintServices(null, null)) {
            if (s.getName().toLowerCase(Locale.ROOT).equals(buscado)) return s;
        }
        return null;
    }

    /** Imprime el PDF; lanza una excepción con un mensaje en español si no se pudo. */
    public static void imprimir(byte[] pdf, String impresora, String documento) throws Exception {
        PrintService servicio = buscar(impresora);
        if (servicio == null) {
            throw new Exception(impresora == null || impresora.isEmpty() ? "No hay impresora predeterminada en Windows" : "No existe la impresora \"" + impresora + "\" en esta PC");
        }
        try (PDDocument doc = PDDocument.load(pdf)) {
            if (doc.getNumberOfPages() == 0) throw new Exception("El PDF no tiene páginas");
            PrinterJob job = PrinterJob.getPrinterJob();
            job.setPrintService(servicio);
            job.setJobName(documento);
            // Papel del tamaño exacto del ticket (ancho 58/80 mm y alto según el contenido), sin márgenes ni escalado.
            Book libro = new Book();
            PDFPrintable contenido = new PDFPrintable(doc, Scaling.ACTUAL_SIZE, false, 0, false);
            for (int i = 0; i < doc.getNumberOfPages(); i++) {
                PDPage pagina = doc.getPage(i);
                PDRectangle caja = pagina.getMediaBox();
                Paper papel = new Paper();
                papel.setSize(caja.getWidth(), caja.getHeight());
                papel.setImageableArea(0, 0, caja.getWidth(), caja.getHeight());
                PageFormat formato = new PageFormat();
                formato.setOrientation(PageFormat.PORTRAIT);
                formato.setPaper(papel);
                libro.append(contenido, formato);
            }
            job.setPageable(libro);
            PrintRequestAttributeSet atributos = new HashPrintRequestAttributeSet();
            atributos.add(new JobName(documento, Locale.getDefault()));
            job.print(atributos);
        }
    }
}
