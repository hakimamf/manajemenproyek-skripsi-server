const Project = require("../../models/Project");
const Customer = require("../../models/Customer");
const Worker = require("../../models/Worker");
const checkAuth = require("../../utils/check-auth");
const {
  validateProjectInput,
  validateUpdateProjectInput,
} = require("../../utils/validators");
const { AuthenticationError, UserInputError } = require("apollo-server-errors");

module.exports = {
  Query: {
    async getProjects() {
      try {
        const projects = await Project.find().sort({ createdAt: -1 });
        return projects;
      } catch (err) {
        throw new Error(err);
      }
    },

    async getProject(_, { projectId }) {
      try {
        const project = await Project.findById(projectId);
        if (project) {
          return project;
        } else {
          throw new Error("Project not found");
        }
      } catch (err) {
        throw new Error(err);
      }
    },
  },

  Mutation: {
    async createProject(
      _,
      {
        input: {
          nama,
          alamat,
          namaCustomer,
          budget,
          startAt,
          endAt,
          namaWorkers,
        },
      },
      context
    ) {
      const user = checkAuth(context);
      //input tidak boleh kosong
      const { valid, errors } = validateProjectInput(
        nama,
        alamat,
        namaCustomer
      );
      if (!valid) {
        throw new UserInputError("Errors", { errors });
      }

      //validate customer, kalau belum terdaftar, daptar dulu bos
      const customer = await Customer.findOne({ nama: namaCustomer });
      if (!customer) {
        throw new UserInputError("customer belum terdaftar", {
          errors: {
            customer: "customer belum terdaftar",
          },
        });
      }

      //validate workers
      //(dah bisa, tapi kalau pakai try-catch bisa gak wkwk)
      const workers = await Worker.find();
      const workerIds = [];
      let ada = false;
      for (i = 0; i < namaWorkers.length; i++) {
        workers.map((wr) => {
          if (namaWorkers[i] === wr.nama) {
            workerIds[i] = wr.id;
            ada = true;
          }
        });
        if (ada == false) {
          errors[`worker ${i}`] = `pekerja ${namaWorkers[i]} belum terdaftar`;
        }
      }
      if (errors.length) {
        throw new UserInputError(`pekerja belum terdaftar`, {
          errors,
        });
      }

      //membuat project
      const newProject = new Project({
        nama,
        alamat,
        namaCustomer,
        budget,
        startAt,
        endAt,
        progres: "0",
        namaWorkers,
        workerIds: workerIds,
        customerId: customer.id,
        user: user.id,
        username: user.username,
        createdAt: new Date().toISOString(),
      });
      await newProject.save();

      //add projectId in customer
      customer.projectIds.push(newProject._id);
      await customer.save();

      //add project id in workers
      for (i = 0; i < workerIds.length; i++) {
        const worker = await Worker.findById(workerIds[i]);
        worker.projectIds.push(newProject._id);
        worker.save();
      }
      return newProject;
    },

    async deleteProject(_, { projectId }, context) {
      const user = checkAuth(context);
      const project = await Project.findById(projectId);
      const customer = await Customer.findById(project.customerId);
      const workers = [{}];
      for (i = 0; i < project.workerIds.length; i++) {
        workers[i] = await Worker.findById(project.workerIds[i]);
      }
      await project.delete();

      //delete projectId in customer
      const customerProjects = customer.projectIds;
      let index = customerProjects.indexOf(projectId);
      if (index > -1) {
        customerProjects.splice(index, 1);
      }
      customer.projectIds = customerProjects;
      await customer.save();

      //delete projectId in workers
      for (i = 0; i < workers.length; i++) {
        const workerProjects = workers[i].projectIds;
        let index = workerProjects.indexOf(projectId);
        if (index > -1) {
          workerProjects.splice(index, 1);
        }
        workers[i].update({ projectIds: workerProjects });
      }

      return "data project berhasil dihapus";
    },

    async updateProject(_, { projectId, input }, context) {
      const user = checkAuth(context);

      //validate input
      const { valid, errors } = validateUpdateProjectInput(input);
      if (!valid) {
        throw new UserInputError("Errors", { errors });
      }

      //update customerId in project
      const { namaCustomer } = input;
      if (namaCustomer) {
        const customer = await Customer.findOne({ nama: namaCustomer });
        if (!customer) {
          throw new UserInputError("customer belum terdaftar", {
            errors: {
              customer: "customer belum terdaftar",
            },
          });
        }
        //change customer id in project
        const project = await Project.findById(projectId);
        const exCustomerId = project.customerId;
        project.customerId = customer._id;
        await project.save();

        //change project id in new customer
        customer.projectIds.push(project._id);
        await customer.save();

        //delete project id in previous customer
        const exCustomer = await Customer.findById(exCustomerId);
        if (exCustomer) {
          const customerProjects = exCustomer.projectIds;
          let index = customerProjects.indexOf(projectId);
          if (index > -1) {
            customerProjects.splice(index, 1);
          }
          exCustomer.projectIds = customerProjects;
          await exCustomer.save();
        }
      }

      //update project
      const result = await Project.findByIdAndUpdate(
        { _id: projectId },
        input,
        {
          new: true,
        }
      );
      return result;
    },

    async updateProjectWorkers(_, { projectId, input, addOrDel }, context) {
      const user = checkAuth(context);
      const project = await Project.findById(projectId);
      const workers = await Worker.find();
      const workerIds = [];
      const errors = {};

      //are workers already in our database?
      let ada = false;
      for (i = 0; i < input.length; i++) {
        workers.map((wr) => {
          if (input[i] === wr.nama) {
            workerIds[i] = wr.id;
            ada = true;
          }
        });
        if (ada == false) {
          errors[`worker ${i}`] = `pekerja ${input[i]} belum terdaftar`;
        }
      }
      if (errors.length) {
        throw new UserInputError(`pekerja belum terdaftar`, {
          errors,
        });
      }

      //update workers in project
      if (addOrDel) {
        //are workers already in this project?
        let sudahAda = false;
        for (i = 0; i < input.length; i++) {
          for (j = 0; j < project.namaWorkers.length; j++) {
            if (input[i] == project.namaWorkers[j]) {
              sudahAda = true;
            }
          }
          if (sudahAda == true) {
            errors[`worker ${i}`] = `pekerja ${input[i]} sudah ada di project`;
          }
        }
        if (errors.length) {
          throw new UserInputError(`pekerja sudah ada`, {
            errors,
          });
        }
        //add workers ids and names
        project.workerIds.push(workerIds);
        project.namaWorkers.push(...input);
        await project.save();

        //add project id in workers
        for (i = 0; i < workerIds.length; i++) {
          const worker = await Worker.findById(workerIds[i]);
          worker.projectIds.push(projectId);
          worker.save();
        }
      } else {
        //delete workers ids and names
        const projectWorkersIds = project.workerIds;
        const projectWorkersNames = project.namaWorkers;
        for (i = 0; i < input.length; i++) {
          let index = projectWorkersIds.indexOf(workerIds[i]);
          let indexn = projectWorkersNames.indexOf(input[i]);
          if (index > -1) {
            projectWorkersIds.splice(index, 1);
          }
          if (indexn > -1) {
            projectWorkersNames.splice(indexn, 1);
          }
        }
        project.workerIds = projectWorkersIds;
        project.namaWorkers = projectWorkersNames;
        await project.save();

        //delete project id in workers
        for (i = 0; i < workerIds.length; i++) {
          const worker = await Worker.findById(workerIds[i]);
          const workerProjects = worker.projectIds;
          let index = workerProjects.indexOf(projectId);
          if (index > -1) {
            workerProjects.splice(index, 1);
          }
          worker.projectIds = workerProjects;
          await worker.save();
        }
      }
      return project;
      //change projectId in
    },
  },

  Project: {
    async customer(parent, args, context) {
      const customer = await Customer.findById(parent.customerId);
      return customer;
    },
    async workers(parent, args, context) {
      const workers = await Worker.find({
        nama: parent.namaWorkers.map((n) => {
          return n;
        }),
      });
      return workers;
    },
  },
};
