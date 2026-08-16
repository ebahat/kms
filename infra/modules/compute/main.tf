# One Always Free Ampere A1 VM running the whole v1.0 stack via docker-compose (ADR-0015).
#
# Free-tier arithmetic (Oracle's Always Free allowance is expressed in monthly hours, not instance
# count): 1,500 OCPU-hours and 9,000 GB-hours per month. Running continuously for a 730-hour month:
#   2 OCPU  x 730 h = 1,460 OCPU-hours  (allowance 1,500)  -> fits, 3% headroom
#   12 GB   x 730 h = 8,760 GB-hours    (allowance 9,000)  -> fits, 3% headroom
# The headroom is deliberately thin because this is the entire free allocation. Provisioning a second
# A1 instance of any size, or bumping either dimension, exceeds it and starts billing. The
# `lifecycle` block below is a guard against exactly that.

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_id
}

# Oracle Linux 9, aarch64 — looked up rather than hardcoded, since image OCIDs are region-specific and
# rotate as Oracle publishes new builds.
data "oci_core_images" "ol9_arm" {
  compartment_id           = var.compartment_id
  operating_system         = "Oracle Linux"
  operating_system_version = "9"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "app" {
  compartment_id      = var.compartment_id
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "kms-${var.env}-app"

  # VM.Standard.A1.Flex is the ONLY shape with a meaningful Always Free allocation. The AMD
  # alternative (VM.Standard.E2.1.Micro) is 1/8 OCPU + 1 GB — too small to run this stack.
  shape = "VM.Standard.A1.Flex"
  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_in_gbs
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ol9_arm.images[0].id
    # 50 GB of the 200 GB Always Free block-storage allowance. The default (46.6 GB) would also work;
    # 50 is explicit so the free-tier budget is legible rather than implied.
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id        = var.subnet_id
    nsg_ids          = [var.nsg_id]
    assign_public_ip = true
    display_name     = "kms-${var.env}-app-vnic"
    hostname_label   = "app"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    # cloud-init installs the container runtime only. It deliberately does NOT pull or start the
    # application: images don't exist in OCIR yet, and baking a deploy into instance creation would
    # make every `terraform apply` a deploy. Deployment is a separate step (deploy/README.md).
    user_data = base64encode(<<-EOF
      #cloud-config
      package_update: true
      packages:
        - docker
        - docker-compose-plugin
      runcmd:
        - systemctl enable --now docker
        - usermod -aG docker opc
        # Oracle Linux ships a default-DENY iptables INPUT chain that silently blocks 80/443 even
        # when the OCI NSG allows them. This is the single most common "the NSG is right but nothing
        # answers" failure on OCI — opening it here rather than leaving it to be rediscovered.
        - firewall-cmd --permanent --add-service=http
        - firewall-cmd --permanent --add-service=https
        - firewall-cmd --reload
    EOF
    )
  }

  lifecycle {
    precondition {
      condition     = var.ocpus <= 2 && var.memory_in_gbs <= 12
      error_message = "Exceeds the OCI Always Free Ampere A1 allocation (2 OCPU / 12 GB). Raising this starts real billing — change it deliberately, not by accident."
    }
  }
}

output "public_ip" {
  value = oci_core_instance.app.public_ip
}

output "ssh_command" {
  value = "ssh opc@${oci_core_instance.app.public_ip}"
}
